import type { ProductListItem } from "src/api/products.endpoints";

/**
 * The listing rollup's price span, as the storefront shows it: one figure
 * when every active price is the same, a range otherwise, a dash when no
 * variant is active. Comparison is on the strings the API sends — no float.
 */
export function priceRange(listing: ProductListItem["listing"], money: (value: string) => string): string {
  const { minActivePrice: min, maxActivePrice: max } = listing;
  if (!min && !max) return "—";
  if (!min || !max || min === max) return money((min ?? max)!);
  return `${money(min)} – ${money(max)}`;
}
