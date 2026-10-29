import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { buildCartLineIdentityKey } from "../../commerce/cart-line.schema";
import { cartRepository, cartLineRepository, variantRepository } from "../../core/repositories";
import type { ShopActor } from "../shop-actor";
import { ensureCart } from "./ensure-cart";
import { normalizeCartNote } from "./normalize-cart-note";
import { toCartView, type CartView } from "./cart-view";
import { CART_LINE_ORDER } from "./cart-line-order";

export interface AddCartLineInput {
  variantId: string;
  quantity: number;
  note?: string;
}

/**
 * `POST /api/shop/cart/lines`. Creates the cart on first use (see
 * `ensure-cart.ts`), then merges into an existing line sharing this line's
 * identity — `(cartId, variantId, normalizedNote)`, via `lineIdentityKey`
 * — or creates a new one.
 *
 * **Phase 4B Batch 3 design-checkpoint conversion**: `CartLine` is a
 * standalone collection now (`cart-line.schema.ts`), not embedded on
 * `Cart`. The merge-or-create step is ONE atomic MongoDB upsert —
 * `$inc` + `$setOnInsert` + `upsert: true` keyed on the unique
 * `lineIdentityKey` — the same idiom `enforce-rate-limit.ts` already uses
 * in this repo, not a bespoke aggregation pipeline. `$inc` on a field that
 * doesn't exist yet (the upsert-creates case) treats it as `0` and sets it
 * to `quantity`, so one call correctly handles both "increment the
 * existing line" and "create a new one at this quantity." Race-safe for
 * the identical reason `ensure-cart.ts`'s `customerId` upsert is: the
 * unique index on `lineIdentityKey` means at most one of two concurrent
 * upserts against the same identity can "win" the insert; MongoDB
 * resolves the rest as ordinary matched updates against that same document
 * (there is no duplicate-key error to catch here at all — unlike
 * `ensure-cart.ts`, `upsert: true` with a matching filter on a unique key
 * is the normal path, not a race-losing exception).
 *
 * The variant existence check is deliberately shallow: does a Variant with
 * this id exist at all. Stock/purchasability is `POST /quote`'s
 * authoritative job (MDS §11.2), not this route's.
 *
 * @throws {NotFoundError} `variantId` doesn't name a real variant.
 */
export async function addCartLine(actor: ShopActor, input: AddCartLineInput): Promise<CartView> {
  const variant = await variantRepository.findOne({ where: { _id: input.variantId }, skipThrowError: true });
  if (!variant) throw new NotFoundError("No such product variant.");

  const variantId = new mongoose.Types.ObjectId(input.variantId);
  const normalizedNote = normalizeCartNote(input.note);

  const { cart, mintedCartToken } = await ensureCart(actor);
  const lineIdentityKey = buildCartLineIdentityKey(cart._id, variantId, normalizedNote);

  await cartLineRepository.updateAtomic(
    { lineIdentityKey },
    { $inc: { quantity: input.quantity }, $setOnInsert: { cartId: cart._id, variantId, note: normalizedNote, lineIdentityKey } },
    { upsert: true, skipThrowError: true }
  );

  const lines = await cartLineRepository.findAll({ where: { cartId: cart._id }, sort: CART_LINE_ORDER });
  const updatedCart = await cartRepository.findOne({ where: { _id: cart._id } });

  const view = toCartView(updatedCart, lines);
  return mintedCartToken ? { ...view, cartToken: mintedCartToken } : view;
}
