import type { LocalizedString } from "@kira-joo/toolkit-common";
import type { ImageAsset, Money } from "@kira-joo/toolkit-common";
import type { QuoteOptionLabel } from "./quote-line-display";

export type QuoteUnavailableReason = "INSUFFICIENT_STOCK" | "DISCONTINUED" | "NOT_PUBLISHED";

export interface QuoteLineView {
  /** The cart line's own id — the handle `/cart/lines/[lineId]` takes. */
  lineId: string;
  variantId: string;
  productId: string;
  productSlug: string;
  /** The variant's gallery override, else the product's primary image. */
  image: ImageAsset | null;
  /** Axis name and value label per option, in both locales. */
  optionLabels: QuoteOptionLabel[];
  /** False when the line cannot be bought right now; it is then excluded from every total. */
  available: boolean;
  unavailableReason?: QuoteUnavailableReason;
  sku: string;
  productName: string;
  variantDescription: string;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface QuotePromotionView {
  /** The applied code, or "" for an automatic promotion. */
  code: string;
  /** True when no code was entered: the store applied this promotion by itself. */
  automatic: boolean;
  /** What to call it on the receipt — an automatic promotion has no code to show. */
  name: LocalizedString;
  subtotalDiscount: Money;
  waivesShippingFee: boolean;
}

export interface QuoteFulfilmentView {
  mode: "DELIVERY" | "PICKUP";
  fee: Money;
  zone?: string;
  dispatchBy: Date;
  promisedWindow: { from: Date; to: Date };
}

/**
 * `POST /api/shop/quote` — authoritative pricing for the current cart +
 * fulfilment, per MDS §11.2.
 *
 * This is what the storefront's checkout displays beside the Place Order
 * button: every line with its price, the promotion if applied, the shipping
 * fee resolved from the selected fulfilment mode, tax, and the total. The
 * storefront never computes its own total — it asks the server and shows the
 * answer.
 *
 * Quote is read-only and ephemeral — no order is created, no stock is
 * reserved, nothing is persisted. It re-prices the cart authoritatively
 * using the exact same engines order placement will use, so the price shown
 * at checkout is the price charged.
 *
 * It is also the cart page's single call: it works before fulfilment is
 * chosen, reports per-line availability instead of failing the whole quote,
 * and an empty (or absent) cart quotes as empty lines at zero.
 */
export interface QuoteView {
  lines: QuoteLineView[];
  subtotal: Money;
  discount: Money;
  /** `null` until a fulfilment draft exists — shipping is then pending and `total` excludes it. */
  shippingFee: Money | null;
  tax: Money;
  total: Money;
  promotion?: QuotePromotionView;
  /** `null` until a fulfilment draft exists. */
  fulfilment: QuoteFulfilmentView | null;
  shippingPending: boolean;
  /** True when at least one line is unavailable — placement would refuse (409) until it is removed. */
  hasUnavailableLines: boolean;
}
