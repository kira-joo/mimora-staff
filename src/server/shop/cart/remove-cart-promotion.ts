import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { cartRepository, cartLineRepository } from "../../core/repositories";
import type { ShopActor } from "../shop-actor";
import { cartFilterForActor } from "./cart-actor-filter";
import { toCartView, type CartView } from "./cart-view";
import { CART_LINE_ORDER } from "./cart-line-order";

/** `DELETE /api/shop/cart/promotion`. Naturally idempotent — clearing an already-absent code is a harmless no-op. */
export async function removeCartPromotion(actor: ShopActor): Promise<CartView> {
  const cart = await cartRepository.updateAtomic(
    cartFilterForActor(actor),
    { $unset: { appliedPromotionCode: 1 } },
    { skipThrowError: true }
  );
  if (!cart) throw new NotFoundError("No cart exists yet — add a line first.");

  const lines = await cartLineRepository.findAll({ where: { cartId: cart._id }, sort: CART_LINE_ORDER });
  return toCartView(cart, lines);
}
