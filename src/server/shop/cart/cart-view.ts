import type mongoose from "mongoose";
import type { CartLineSchema } from "../../commerce/cart-line.schema";
import type { CartFulfilmentDraft, CartSchema } from "../../commerce/cart.schema";

export interface CartLineView {
  /**
   * The CartLine document's own `_id` — Phase 4B Batch 3's conversion to a
   * standalone `CartLineModel` dropped the separate app-generated UUID the
   * embedded design used, since a real Mongo document already carries a
   * unique identity for free. Still an opaque string from the client's
   * perspective; the field name and its role in `/cart/lines/[lineId]`
   * are unchanged.
   */
  lineId: string;
  variantId: mongoose.Types.ObjectId;
  quantity: number;
  note?: string;
}

export interface CartView {
  lines: CartLineView[];
  fulfilmentDraft?: CartFulfilmentDraft;
  appliedPromotionCode?: string;
  /** Present when this response corresponds to a guest cart — the caller must persist it and send it as `x-cart-token` on every subsequent `/api/shop/**` request. */
  cartToken?: string;
}

/**
 * The one shape every Cart route in this batch (and `GET /cart`) returns —
 * manual field picking, not a generic serializer, matching this file's own
 * established convention. Takes the Cart document and its CartLine
 * documents separately — they are no longer read from the same query.
 */
export function toCartView(
  cart: Pick<CartSchema, "fulfilmentDraft" | "appliedPromotionCode" | "cartToken">,
  lines: Pick<CartLineSchema, "_id" | "variantId" | "quantity" | "note">[]
): CartView {
  return {
    lines: lines.map((line) => ({ lineId: line._id.toString(), variantId: line.variantId, quantity: line.quantity, note: line.note })),
    fulfilmentDraft: cart.fulfilmentDraft,
    appliedPromotionCode: cart.appliedPromotionCode,
    cartToken: cart.cartToken,
  };
}
