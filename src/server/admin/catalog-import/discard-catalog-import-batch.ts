import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { catalogImportBatchRepository } from "../../core/repositories";
import type { CatalogImportBatchSchema } from "../../catalog/catalog-import-batch.schema";

/**
 * Discards a staged batch that turned out to be wrong before it ever went
 * live — never mutates live catalog data (nothing has, by definition, for
 * a batch that's still `STAGED`), so unlike publish this needs no cache
 * invalidation. Only a `STAGED` batch can be discarded; a `PUBLISHED` one
 * is already live and a `DISCARDED` one already is what this asks for.
 */
export async function discardCatalogImportBatch(batchId: string): Promise<CatalogImportBatchSchema> {
  const batch = await catalogImportBatchRepository.findOne({ where: { _id: batchId } });

  if (batch.status !== "STAGED") {
    throw new ConflictError(`Cannot discard a batch with status ${batch.status} — only a STAGED batch can be discarded`);
  }

  return catalogImportBatchRepository.updateAtomic(
    { _id: batchId, status: "STAGED" },
    { $set: { status: "DISCARDED" } }
  );
}
