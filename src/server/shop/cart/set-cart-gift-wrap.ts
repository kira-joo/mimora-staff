import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { cartLineRepository, cartRepository } from "../../core/repositories";
import type { ShopActor } from "../shop-actor";
import { cartFilterForActor } from "./cart-actor-filter";
import { CART_LINE_ORDER } from "./cart-line-order";
import { toCartView, type CartView } from "./cart-view";

/**
 * Records the customer's gift box & wrapping choice on their cart. Only the choice is stored — whether it is offered
 * and what it costs are decided at quote and placement time by `resolveGiftWrap`, from the live settings.
 */
export async function setCartGiftWrap(actor: ShopActor, giftWrap: boolean): Promise<CartView> {
  const cart = await cartRepository.updateAtomic(cartFilterForActor(actor), { $set: { giftWrap } }, { skipThrowError: true });
  if (!cart) throw new NotFoundError("No cart exists yet — add a line first.");
  const lines = await cartLineRepository.findAll({ where: { cartId: cart._id }, sort: CART_LINE_ORDER });
  return toCartView(cart, lines);
}
