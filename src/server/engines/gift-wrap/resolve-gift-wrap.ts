import { roundMoney, type Money } from "@kira-joo/toolkit-common";

export interface GiftWrapSettings {
  giftWrapEnabled?: boolean;
  giftWrapFee?: Money | null;
}

export interface GiftWrapResolution {
  /** Whether the storefront offers the option at all: enabled in Staff AND a fee is set. */
  available: boolean;
  /** Whether the customer ticked it — only ever true when it is available. */
  selected: boolean;
  /** The fee the option costs (shown beside the checkbox), or null when not available. */
  fee: Money | null;
  /** What this order is charged for it: the fee when selected, otherwise undefined (no line on the order). */
  charge: Money | undefined;
}

/**
 * Gift box & wrapping, once per order. The ONE rule the quote and order placement both apply, so what a customer is
 * shown is exactly what they are charged. A tick on a cart whose store has since turned the option off (or cleared
 * its fee) charges nothing — the box is simply no longer offered.
 */
export function resolveGiftWrap(settings: GiftWrapSettings, requested: boolean | undefined): GiftWrapResolution {
  const fee = settings.giftWrapFee ? roundMoney(settings.giftWrapFee) : null;
  const available = settings.giftWrapEnabled === true && fee !== null && fee.greaterThan(0);
  const selected = available && requested === true;
  return { available, selected, fee: available ? fee : null, charge: selected ? fee! : undefined };
}
