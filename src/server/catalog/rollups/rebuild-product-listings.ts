import { SortOrder } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { productRepository } from "../../core/repositories";
import { maintainProductListingRollup } from "./maintain-product-listing";

/** Products read per page. The per-product work is its own transaction, so this only bounds memory and the cursor. */
export const REBUILD_LISTINGS_BATCH_SIZE = 100;

export interface RebuildListingsResult {
  /** Products whose rollup was recomputed. */
  processed: number;
  /** Pages read — `ceil(processed / batchSize)`. */
  batches: number;
}

/**
 * Recomputes the listing rollup of EVERY product, in batches of `batchSize`
 * (keyset-paged on `_id`, so a product created mid-run is neither skipped nor
 * visited twice), one transaction per product.
 *
 * Needed once after the rollup gained fields (`availableOptions`, the low-stock
 * facts): products written before that carry none of them, so an option filter
 * would exclude them and a card would never show low stock until some variant
 * write happened to touch them. Safe to re-run — the rollup is a pure recompute.
 *
 * Maintaining a rollup is not a publish: this never invalidates a cache (a
 * rollup is not a mutation over HTTP). The route that exposes it,
 * `POST /api/admin/catalog/rebuild-listings`, declares the PRODUCTS tag.
 */
export async function rebuildAllProductListings(batchSize: number = REBUILD_LISTINGS_BATCH_SIZE): Promise<RebuildListingsResult> {
  let processed = 0;
  let batches = 0;
  let after: unknown;

  for (;;) {
    const page = await productRepository.findAll({
      where: after === undefined ? {} : { _id: { $gt: after } },
      sort: { field: "_id", order: SortOrder.ASC },
      select: { _id: true },
      take: batchSize,
      lean: true,
    });
    if (page.length === 0) break;
    batches += 1;

    for (const product of page) {
      await withTransaction(async (tx) => {
        await maintainProductListingRollup(product._id);
        return tx.complete(undefined);
      });
      processed += 1;
    }
    after = page[page.length - 1]!._id;
    if (page.length < batchSize) break;
  }
  return { processed, batches };
}
