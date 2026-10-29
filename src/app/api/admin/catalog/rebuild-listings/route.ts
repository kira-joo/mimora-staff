import { createPostRoute } from "../../../../../server/core/route-factories";
import { rebuildAllProductListings } from "../../../../../server/catalog/rollups/rebuild-product-listings";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * Recomputes every product's listing rollup (`listing.availableOptions`, the low-stock facts, price range, purchasable
 * count) from its variants — the backfill for products written before a rollup field existed.
 *
 * Held by `Catalog.publish`, the same power as a catalog import going live: both are "make the storefront's listing
 * data current". Idempotent (a pure recompute), so it needs no `Idempotency-Key`. The route declares the PRODUCTS tag,
 * which the factory publishes only on success — the rebuild itself, like any rollup maintenance, never touches a cache.
 */
export const POST = createPostRoute({
  auth: { permissions: [CustomPermission.CATALOG_PUBLISH] },
  successStatus: 200,
  revalidateTags: ["PRODUCTS"],
  handler: async () => rebuildAllProductListings(),
});
