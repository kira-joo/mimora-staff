import type { Money } from "@kira-joo/toolkit-common";

export interface CompareAtCandidate {
  price: Money;
  compareAtPrice?: Money;
  purchasable: boolean;
}

/**
 * The listing's "Sale" signal: the compare-at price of the cheapest
 * PURCHASABLE variant, present only when that variant genuinely discounts —
 * a compare-at that is absent, equal to, or below the price is no sale.
 *
 * It follows the cheapest price a shopper can actually take, so the
 * struck-through figure belongs to a variant they can buy (which can differ
 * from `minActivePrice`, which also counts out-of-stock variants). When
 * several purchasable variants tie on the cheapest price, the one with the
 * largest valid compare-at speaks for them. A product with nothing purchasable
 * has no sale signal (its listing price is not an offer anyone can take).
 */
export function resolveListingCompareAt(variants: CompareAtCandidate[]): Money | undefined {
  const purchasable = variants.filter((variant) => variant.purchasable);
  if (purchasable.length === 0) return undefined;

  const cheapest = purchasable.reduce((min, variant) => (variant.price.lessThan(min) ? variant.price : min), purchasable[0]!.price);

  let best: Money | undefined;
  for (const variant of purchasable) {
    if (!variant.price.equals(cheapest) || variant.compareAtPrice === undefined) continue;
    if (!variant.compareAtPrice.greaterThan(variant.price)) continue;
    if (best === undefined || variant.compareAtPrice.greaterThan(best)) best = variant.compareAtPrice;
  }
  return best;
}
