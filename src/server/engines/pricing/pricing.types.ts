import type { Money } from "@kira-joo/toolkit-common";

/**
 * The effect a promotion has on pricing. Shared between the pricing and
 * promotion engines rather than each declaring its own copy — pricing takes
 * exactly what promotion produces.
 */
export interface AppliedDiscount {
  subtotalDiscount: Money;
  waivesShippingFee: boolean;
}

export interface PricingLineInput {
  unitBasePrice: Money;
  quantity: number;
}

/**
 * `tax.mode` mirrors `StoreProfile.tax.mode` exactly (see
 * `content/store-profile.schema.ts`) — one flat rate for the whole store,
 * either added on top of the price or already included in it. There is no
 * `NONE` mode: a rate of `0` produces zero tax under either mode, so a third
 * mode would be a distinction without a difference.
 */
export interface PricingInput {
  lines: PricingLineInput[];
  discount?: AppliedDiscount;
  /** Absent for pickup, where there is nothing to charge. */
  shippingFee?: Money;
  tax: { mode: "INCLUDED" | "ADDED"; rate: number };
}

export interface PricedLine {
  unitBasePrice: Money;
  quantity: number;
  lineTotal: Money;
}

/**
 * Mirrors `Order.subtotal`/`discount`/`tax`/`total` and
 * `Order.fulfilment.fee` exactly — see MDS §8.4 `Order.pricing {subtotal,
 * discount, shippingFee, tax, total}`. There is deliberately no service fee:
 * neither the canonical MDS nor the committed `OrderSchema` has one, unlike
 * the restaurant precedent this engine was first ported from.
 */
export interface PricingResult {
  lines: PricedLine[];
  subtotal: Money;
  discount: Money;
  shippingFee: Money;
  tax: Money;
  total: Money;
}
