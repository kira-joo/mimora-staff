export interface LowStockInput {
  purchasable: boolean;
  backorderPolicy: "DENY" | "CONTINUE_SELLING";
  stock: number;
  /** The variant's own override; absent means the store-wide default applies. */
  variantThreshold?: number;
  /** `InventorySettings.lowStockThreshold`. */
  defaultThreshold: number;
}

/**
 * The storefront's "only a few left" signal — a boolean, never the quantity.
 *
 * True only for a variant that can be bought right now AND whose stock is
 * actually tracked (`DENY`) AND sits at or below its effective threshold. A
 * `CONTINUE_SELLING` variant is untracked for this purpose — its stock is not
 * a constraint, so "few left" would be a false urgency. Boundary matches
 * `classifyStockHealth` (`stock <= threshold` is low); out of stock is not
 * purchasable, so it is never "low".
 */
export function resolveLowStock(input: LowStockInput): boolean {
  if (!input.purchasable) return false;
  if (input.backorderPolicy === "CONTINUE_SELLING") return false;
  return input.stock <= (input.variantThreshold ?? input.defaultThreshold);
}
