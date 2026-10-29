import mongoose, { type HydratedDocument } from "mongoose";
import type { CartSchema } from "../../commerce/cart.schema";
import { cartRepository } from "../../core/repositories";
import { mintCartToken, type ShopActor } from "../shop-actor";

export interface EnsuredCart {
  cart: HydratedDocument<CartSchema>;
  /** Present only when a guest with no usable cart token (none, or one matching no cart) was just given a fresh one — the caller must return it. */
  mintedCartToken?: string;
}

/**
 * The only place a Cart document is ever created — `POST /cart/lines`,
 * matching `get-cart.ts`'s own doc comment ("the first line added is what
 * actually creates the cart... a later route, not this one").
 *
 * **Race-safe by construction, not by assumption.** `CartSchema.customerId`
 * carries `@Unique({sparse:true})` specifically so this upsert is safe
 * against two concurrent "add the first line" requests for the same
 * customer: MongoDB's unique index guarantees at most one of two
 * concurrent inserts against the same `customerId` succeeds, and the
 * loser's `findOneAndUpdate` throws a duplicate-key error rather than
 * silently creating a second cart. That loser re-reads and gets the
 * winner's document — the exact catch-and-reread pattern
 * `mongo-idempotency-store.ts`'s `begin()` already uses in this repo for
 * the identical class of upsert race.
 *
 * A guest with no `cartToken` header, or one that matches no cart, gets a freshly minted one here —
 * the caller must surface it in the response (`CartView.cartToken`) so the
 * storefront can persist and resend it.
 */
export async function ensureCart(actor: ShopActor): Promise<EnsuredCart> {
  if (actor.kind === "customer") {
    const filter = { customerId: new mongoose.Types.ObjectId(actor.customer._id) };
    return { cart: await upsertCart(filter) };
  }

  if (actor.cartToken) {
    // Only a token that already names a cart is honoured. An unknown token must
    // never become a new cart's identity — that is session fixation: an attacker
    // could plant a token they know in a victim's browser and later read the cart.
    const existing = await cartRepository.findOne({ where: { cartToken: actor.cartToken }, skipThrowError: true });
    if (existing) return { cart: existing as HydratedDocument<CartSchema> };
  }

  const mintedCartToken = mintCartToken();
  const cart = await upsertCart({ cartToken: mintedCartToken });

  return { cart, mintedCartToken };
}

async function upsertCart(filter: Record<string, unknown>): Promise<HydratedDocument<CartSchema>> {
  const cart = await cartRepository.updateAtomic(filter, { $setOnInsert: filter }, { upsert: true, skipThrowError: true });
  if (!cart) throw new Error("upsert with updateAtomic unexpectedly returned null");
  return cart as HydratedDocument<CartSchema>;
}
