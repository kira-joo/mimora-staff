import type { Money } from "@kira-joo/toolkit-common";

/**
 * The compact per-variant projection the product page needs — **not** admin
 * inventory detail. `purchasable` is a precomputed boolean (from the
 * purchasability engine), not stock itself: the storefront never sees a
 * remaining-units count, only whether the combination can be bought.
 */
export interface MatrixVariant {
  variantId: string;
  /** Exactly one value per axis, every axis present — mirrors `VariantSchema.optionValues`. */
  optionValues: { key: string; value: string }[];
  price: Money;
  compareAtPrice?: Money;
  purchasable: boolean;
  /** Purchasable, stock-tracked and at/below its effective low-stock threshold. A signal only — the quantity is never exposed. */
  lowStock: boolean;
}

/** The customer's current, possibly-partial choice: one value per axis chosen so far. */
export type AxisSelection = Record<string, string>;

/**
 * Four generic axes means the product needs a configurator, not a variant
 * selector — the combinatorics of "which values remain selectable" stop being
 * a cheap client-side computation well before then.
 */
export const MAX_OPTION_AXES = 3;
