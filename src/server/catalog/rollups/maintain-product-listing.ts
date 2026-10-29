import type { Money } from "@kira-joo/toolkit-common";
import type { Types } from "mongoose";
import { productRepository, variantRepository } from "../../core/repositories";
import { resolveListingCompareAt } from "./listing-compare-at";
import { collectAvailableOptions, summarizeLowStock, type LowStockVariant, type OptionVariant } from "./listing-options";

/**
 * Recomputes and writes `Product.listing{}` from the product's current
 * variants, inside the caller's transaction.
 *
 * **Recompute via aggregation, not incremental increment/decrement.**
 * Maintaining a running min/max price incrementally is genuinely hard to
 * get right on a delete or a price decrease past the old minimum (the new
 * minimum is not derivable from the old one without re-scanning anyway).
 * Variant writes are not the same contention class as `Order` placement's
 * per-unit stock decrement — MDS §12 itself already calls a popular
 * product's rollup "a contention point, accepted tradeoff" for the count,
 * and a full aggregate over one product's own variants (never more than a
 * few dozen, per the 3-axis cap the variant-matrix engine already enforces)
 * is cheap next to that. Simple and always exactly correct beats a
 * hand-maintained running value that can drift.
 *
 * **`minActivePrice`/`maxActivePrice`** — the price range across variants
 * that are not discontinued ("active" catalog set), independent of current
 * stock: a temporarily out-of-stock item's price is still real information.
 *
 * **`compareAtPrice`** — the "Sale" signal: the cheapest purchasable
 * variant's compare-at price, present only when it exceeds that variant's
 * price. See `resolveListingCompareAt`.
 *
 * **`purchasableVariantCount`** — a stricter subset: not discontinued AND
 * (`backorderPolicy === "CONTINUE_SELLING"` OR `stock > 0`). Mirrors
 * `engines/purchasability/resolve-purchasability.ts`'s own per-variant
 * checks, minus the product-lifecycle gate — lifecycle is evaluated by
 * whoever queries products (a draft product is not surfaced at all,
 * regardless of its rollup values), not a property of the variant set
 * itself.
 *
 * **`availableOptions`** — the `key:value` option pairs present on at least one
 * PURCHASABLE variant (`collectAvailableOptions`). This is what the storefront's
 * size/colour filters and facet counts read, so a value that exists only on a
 * sold-out variant is not offered. Product-level existence: "size M" and "colour
 * red" each exist on some purchasable variant — not necessarily the same one.
 *
 * **`lowStockOverride` / `minTrackedStock`** — the low-stock facts
 * (`summarizeLowStock`), deliberately independent of the store-wide threshold so
 * changing that setting never leaves the rollup stale; the threshold is applied at
 * read time (`resolveListingLowStock`).
 *
 * **`primaryImage`** — `Product.images[0]` (the product's own primary
 * gallery) if set; otherwise the first purchasable variant's own
 * `galleryOverride[0]`, so a product with no gallery of its own still shows
 * something on a listing card.
 *
 * Call after any variant write that can change these: create, delete,
 * `discontinued` toggle, `price` change, `stock` crossing zero. No route
 * calls this yet (Phase 4A.5 builds no routes) — integration tests call it
 * directly, exercising the exact transactional shape a future admin
 * variant-mutation route will call it from.
 *
 * Takes no `session` parameter — the repositories resolve the ambient
 * transaction session and report the write themselves.
 */
export async function maintainProductListingRollup(productId: Types.ObjectId): Promise<void> {
  // Sequential, not `Promise.all`: one transaction session cannot run concurrent operations.
  const product = await productRepository.findOne({ where: { _id: productId }, skipThrowError: true });
  const activeVariants = await variantRepository.findAll({ where: { productId, discontinued: false } });

  if (!product) return;

  let minActivePrice: Money | undefined;
  let maxActivePrice: Money | undefined;
  let purchasableVariantCount = 0;
  let firstPurchasableGalleryImage: unknown;
  const compareAtCandidates: Parameters<typeof resolveListingCompareAt>[0] = [];
  const optionVariants: OptionVariant[] = [];
  const lowStockVariants: LowStockVariant[] = [];

  for (const variant of activeVariants) {
    if (minActivePrice === undefined || variant.price.lessThan(minActivePrice)) minActivePrice = variant.price;
    if (maxActivePrice === undefined || variant.price.greaterThan(maxActivePrice)) maxActivePrice = variant.price;

    const purchasable = variant.backorderPolicy === "CONTINUE_SELLING" || variant.stock > 0;
    compareAtCandidates.push({ price: variant.price, compareAtPrice: variant.compareAtPrice, purchasable });
    optionVariants.push({ optionValues: variant.optionValues ?? [], purchasable });
    lowStockVariants.push({ purchasable, backorderPolicy: variant.backorderPolicy, stock: variant.stock, lowStockThreshold: variant.lowStockThreshold });
    if (purchasable) {
      purchasableVariantCount += 1;
      if (!firstPurchasableGalleryImage && variant.galleryOverride && variant.galleryOverride.length > 0) {
        firstPurchasableGalleryImage = variant.galleryOverride[0];
      }
    }
  }

  const compareAtPrice = resolveListingCompareAt(compareAtCandidates);
  const primaryImage = product.images?.[0] ?? firstPurchasableGalleryImage;

  /*
   * `$set` with an `undefined` value does not clear a MongoDB field — the
   * driver drops that key from the update entirely, so a stale price from
   * the last time a variant existed survives forever once the last active
   * variant is deleted. `purchasableVariantCount` is always a real number
   * (0 included) and always goes through `$set`; the three genuinely
   * optional fields go through `$unset` when they have nothing to hold,
   * `$set` otherwise. Plain object form (not an aggregation-pipeline
   * array) throughout — the verified-working shape for `moneyField()`'s
   * setter, per that field's own doc comment.
   */
  const lowStock = summarizeLowStock(lowStockVariants);
  const setFields: Record<string, unknown> = {
    "listing.purchasableVariantCount": purchasableVariantCount,
    "listing.availableOptions": collectAvailableOptions(optionVariants),
    "listing.lowStockOverride": lowStock.lowStockOverride,
  };
  const unsetFields: Record<string, ""> = {};

  if (lowStock.minTrackedStock === undefined) unsetFields["listing.minTrackedStock"] = "";
  else setFields["listing.minTrackedStock"] = lowStock.minTrackedStock;

  if (minActivePrice === undefined) unsetFields["listing.minActivePrice"] = "";
  else setFields["listing.minActivePrice"] = minActivePrice;

  if (maxActivePrice === undefined) unsetFields["listing.maxActivePrice"] = "";
  else setFields["listing.maxActivePrice"] = maxActivePrice;

  if (compareAtPrice === undefined) unsetFields["listing.compareAtPrice"] = "";
  else setFields["listing.compareAtPrice"] = compareAtPrice;

  if (primaryImage === undefined) unsetFields["listing.primaryImage"] = "";
  else setFields["listing.primaryImage"] = primaryImage;

  await productRepository.updateAtomic(
    { _id: productId },
    { $set: setFields, ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}) },
    { skipThrowError: true }
  );
}
