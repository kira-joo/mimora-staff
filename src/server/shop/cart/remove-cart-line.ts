import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { cartRepository, cartLineRepository } from "../../core/repositories";
import type { ShopActor } from "../shop-actor";
import { cartFilterForActor } from "./cart-actor-filter";
import { toCartView, type CartView } from "./cart-view";
import { CART_LINE_ORDER } from "./cart-line-order";

/**
 * `DELETE /api/shop/cart/lines/[lineId]`. Naturally idempotent — removing
 * an already-removed line is a no-op the caller can safely retry, so this
 * still throws only when the CART itself doesn't belong to this actor,
 * never when the line is simply already gone.
 */
export async function removeCartLine(actor: ShopActor, lineId: string): Promise<CartView> {
  const cart = await cartRepository.findOne({ where: cartFilterForActor(actor), skipThrowError: true });
  if (!cart) throw new NotFoundError("No cart exists yet — add a line first.");

  await cartLineRepository.delete({ where: { _id: lineId, cartId: cart._id }, skipThrowError: true });

  const lines = await cartLineRepository.findAll({ where: { cartId: cart._id }, sort: CART_LINE_ORDER });
  return toCartView(cart, lines);
}
