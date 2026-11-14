import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { catalogImportBatchRepository } from "../../core/repositories";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import type { CatalogImportBatchSchema } from "../../catalog/catalog-import-batch.schema";
import { applyCatalogImportPlan } from "./apply-catalog-import";
import { loadCatalogSnapshot } from "./load-catalog-snapshot";
import { planCatalogImport } from "./plan-catalog-import";
import { importAttributeIdentityErrors } from "./import-attribute-identity";
import { loadAttributeCatalog } from "../../catalog/attribute-catalog-store";
import type { ImportIssue, ImportProduct } from "./import-types";

/**
 * Publishes a staged batch: applies it to the live catalog in ONE transaction, or not at all.
 *
 * Per MDS §12 ("bulk import never invalidates") this is the only act that goes live; the route declares the cache
 * tags, and the route factory publishes them only when this returns. Nothing here — and nothing in staging —
 * touches a cache.
 *
 * - **Only a `STAGED` batch with no row errors may publish.** A `PUBLISHED` or `DISCARDED` one is an invalid
 *   transition (409), not a silent no-op.
 * - **Idempotent.** The first act inside the transaction is the claim — `STAGED → PUBLISHED` guarded in the update
 *   filter itself, not read-then-write — so a second publish of the same batch, sequential or concurrent, is a 409
 *   and applies nothing. Because the claim is inside the transaction, a failed publish rolls the claim back too: the
 *   batch stays `STAGED` and can be retried.
 * - **Re-validated against the catalog as it is NOW.** Staging validated the file when it was uploaded; a category
 *   may have been deleted or a SKU taken since. A problem found here refuses the whole batch (409, nothing applied).
 */
export async function publishCatalogImportBatch(batchId: string, publishedBy: string): Promise<CatalogImportBatchSchema> {
  const batch = await catalogImportBatchRepository.findOne({ where: { _id: batchId } });

  if (batch.status !== "STAGED") {
    throw new ConflictError(`Cannot publish a batch with status ${batch.status} — only a STAGED batch can be published`);
  }
  if (batch.rowErrors.length > 0) {
    throw new ConflictError("Cannot publish a batch with unresolved row errors");
  }

  return withTransaction(async (tx) => {
    // Two publishers of one batch contend on the claim below; the loser must still be standing when the winner commits, to read it as PUBLISHED and answer 409 rather than 503.
    await backOffBeforeRetry(tx.attempt);
    const now = new Date();
    const claimed = await catalogImportBatchRepository.updateAtomic(
      { _id: batchId, status: "STAGED" },
      { $set: { status: "PUBLISHED", publishedBy, publishedAt: now } },
      { skipThrowError: true }
    );
    if (!claimed) throw new ConflictError("This batch was already published or discarded — it is applied at most once.");

    const products = batch.rows as ImportProduct[];
    const plan = planCatalogImport(products, await loadCatalogSnapshot(products));
    // Re-checked against the catalog as it is NOW: another product may have taken an attribute name since staging.
    const errors = [...plan.errors, ...importAttributeIdentityErrors(plan.products, await loadAttributeCatalog())];
    if (errors.length > 0) {
      const first = errors[0] as ImportIssue;
      throw new ConflictError(
        `The catalog changed since this batch was staged: ${errors.length} problem${errors.length === 1 ? "" : "s"} now. First, on line ${first.row}: ${first.message} Nothing was published — discard this batch and stage the file again.`
      );
    }

    const result = await applyCatalogImportPlan(plan, { actorId: publishedBy, now, note: batch.filename ? `Catalog import: ${batch.filename}` : "Catalog import" });
    const published = await catalogImportBatchRepository.updateAtomic({ _id: batchId }, { $set: { publishResult: result } });
    return tx.complete(published);
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}
