import { resolveLowStock } from "../../engines/variant-matrix/resolve-low-stock";

/**
 * Pure derivations the listing rollup stores (plan #7 and #19). Kept apart from
 * `maintain-product-listing.ts` so the rules are testable without a database.
 */

/** `size:m` — the encoding of one option value in `Product.listing.availableOptions`. Keys never contain a colon (a filter is `key:value`, split at the first one). */
export function optionPair(key: string, value: string): string {
  return `${key}:${value}`;
}

export interface OptionVariant {
  optionValues: ReadonlyArray<{ key: string; value: string }>;
  /** Not discontinued AND (backorder allowed OR stock on hand). */
  purchasable: boolean;
}

/**
 * The option values that can actually be bought: the union of `optionValues`
 * across PURCHASABLE variants only. A value present solely on a sold-out or
 * discontinued variant is not available, so it neither filters nor counts —
 * the sparse-matrix case: with S/red in stock and M/blue sold out, `size:m` and
 * `colour:blue` are absent.
 *
 * Sorted and unique, so the stored array is deterministic and a no-op recompute
 * writes the same value.
 */
export function collectAvailableOptions(variants: ReadonlyArray<OptionVariant>): string[] {
  const pairs = new Set<string>();
  for (const variant of variants) {
    if (!variant.purchasable) continue;
    for (const option of variant.optionValues) pairs.add(optionPair(option.key, option.value));
  }
  return [...pairs].sort();
}

export interface LowStockVariant {
  purchasable: boolean;
  backorderPolicy: "DENY" | "CONTINUE_SELLING";
  stock: number;
  /** The variant's own override; absent means the store-wide default applies. */
  lowStockThreshold?: number;
}

/** What the rollup stores about low stock — independent of the store-wide threshold, so changing that setting never leaves it stale. */
export interface ListingLowStockFacts {
  /** A purchasable, stock-tracked variant with its OWN threshold is at or below it. */
  lowStockOverride: boolean;
  /** The smallest stock among purchasable, stock-tracked variants that use the store-wide threshold. Absent when there are none. */
  minTrackedStock?: number;
}

export function summarizeLowStock(variants: ReadonlyArray<LowStockVariant>): ListingLowStockFacts {
  let lowStockOverride = false;
  let minTrackedStock: number | undefined;

  for (const variant of variants) {
    if (variant.lowStockThreshold !== undefined && variant.lowStockThreshold !== null) {
      // The engine owns "purchasable AND tracked AND at or below threshold"; the default is irrelevant when an override exists.
      if (resolveLowStock({ purchasable: variant.purchasable, backorderPolicy: variant.backorderPolicy, stock: variant.stock, variantThreshold: variant.lowStockThreshold, defaultThreshold: 0 })) lowStockOverride = true;
      continue;
    }
    // "Tracked and purchasable" is exactly what the engine says is low under an infinite threshold.
    const tracked = resolveLowStock({ purchasable: variant.purchasable, backorderPolicy: variant.backorderPolicy, stock: variant.stock, defaultThreshold: Number.POSITIVE_INFINITY });
    if (tracked && (minTrackedStock === undefined || variant.stock < minTrackedStock)) minTrackedStock = variant.stock;
  }

  return minTrackedStock === undefined ? { lowStockOverride } : { lowStockOverride, minTrackedStock };
}

/** The card's "only a few left" signal: the stored facts meet the CURRENT store-wide threshold (`stock <= threshold` is low, matching `resolveLowStock`). */
export function resolveListingLowStock(facts: { lowStockOverride?: boolean; minTrackedStock?: number | null } | undefined, defaultThreshold: number): boolean {
  if (!facts) return false;
  if (facts.lowStockOverride) return true;
  return typeof facts.minTrackedStock === "number" && facts.minTrackedStock <= defaultThreshold;
}
