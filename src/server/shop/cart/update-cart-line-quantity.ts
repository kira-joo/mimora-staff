import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { cartRepository, cartLineRepository } from "../../core/repositories";
import type { ShopActor } from "../shop-actor";
import { cartFilterForActor } from "./cart-actor-filter";
import { toCartView, type CartView } from "./cart-view";
import { CART_LINE_ORDER } from "./cart-line-order";

/**
 * `PUT /api/shop/cart/lines/[lineId]` — sets an absolute quantity.
 * Naturally idempotent: the same request twice sets the same end state, no
 * `claimIdempotentMutation` needed (approved scope).
 *
 * Ownership is enforced in two steps now that `CartLine` is a standalone
 * collection (Phase 4B Batch 3): resolve the actor's OWN cart first (never
 * a client-supplied cart id), then scope the line update by that cart's
 * `_id` — `{_id: lineId, cartId: cart._id}` — so a lineId belonging to a
 * different actor's cart can never be targeted, matching the same
 * ownership guarantee the embedded-array design had, just as two queries
 * instead of one.
 *
 * @throws {NotFoundError} No cart, or no line with this id, belongs to this actor.
 */
export async function updateCartLineQuantity(actor: ShopActor, lineId: string, quantity: number): Promise<CartView> {
  const cart = await cartRepository.findOne({ where: cartFilterForActor(actor), skipThrowError: true });
  if (!cart) throw new NotFoundError("No such line in this cart.");

  const updated = await cartLineRepository.updateAtomic(
    { _id: lineId, cartId: cart._id },
    { $set: { quantity } },
    { skipThrowError: true }
  );
  if (!updated) throw new NotFoundError("No such line in this cart.");

  const lines = await cartLineRepository.findAll({ where: { cartId: cart._id }, sort: CART_LINE_ORDER });
  return toCartView(cart, lines);
}
