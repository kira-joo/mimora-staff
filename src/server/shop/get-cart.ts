import mongoose from "mongoose";
import { cartRepository, cartLineRepository } from "../core/repositories";
import type { ShopActor } from "./shop-actor";
import { toCartView, type CartView } from "./cart/cart-view";

export type { CartView };

const EMPTY_CART: CartView = { lines: [] };

/**
 * Reads the current cart for whoever `resolveShopActor` resolved — a
 * signed-in customer's cart by `customerId`, or a guest's by `cartToken`.
 *
 * A GET has no side effects: a guest with no cart token yet, or a customer
 * who has never added a line, gets an empty cart view rather than a
 * document created on read. The first line added is what actually creates
 * the cart (and, for a guest, mints the token) — a later route, not this
 * one.
 *
 * Two queries, not one — `CartLineModel` is its own collection (Phase 4B
 * Batch 3), and `@Relation` in this toolkit is populate-forward-only (the
 * side holding the `ObjectId`), so there is no single populated read from
 * `Cart` down to its lines.
 */
export async function getCart(actor: ShopActor): Promise<CartView> {
  const cart =
    actor.kind === "customer"
      ? await cartRepository.findOne({ where: { customerId: new mongoose.Types.ObjectId(actor.customer._id) }, skipThrowError: true })
      : actor.cartToken
        ? await cartRepository.findOne({ where: { cartToken: actor.cartToken }, skipThrowError: true })
        : null;

  if (!cart) return EMPTY_CART;

  const lines = await cartLineRepository.findAll({ where: { cartId: cart._id } });
  return toCartView(cart, lines);
}
