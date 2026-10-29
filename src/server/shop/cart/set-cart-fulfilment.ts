import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { cartRepository, cartLineRepository, pickupLocationRepository } from "../../core/repositories";
import type { ShopActor } from "../shop-actor";
import { cartFilterForActor } from "./cart-actor-filter";
import { toCartView, type CartView } from "./cart-view";
import { CART_LINE_ORDER } from "./cart-line-order";

export interface SetCartFulfilmentInput {
  mode: "DELIVERY" | "PICKUP";
  address?: {
    recipientName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    governorate: string;
    postalCode?: string;
  };
  pickupLocationId?: string;
}

/**
 * `PUT /api/shop/cart/fulfilment`. Stores only the customer's raw
 * selection — never a resolved fee/zone/dispatch date, which is `POST
 * /quote`'s job (see `CartFulfilmentDraft`'s own doc comment). Requires an
 * existing cart — setting fulfilment before adding anything has nothing to
 * attach to.
 *
 * @throws {NotFoundError} No cart exists yet, or (PICKUP mode) `pickupLocationId` doesn't name a real, active pickup location.
 */
export async function setCartFulfilment(actor: ShopActor, input: SetCartFulfilmentInput): Promise<CartView> {
  if (input.mode === "PICKUP") {
    const location = await pickupLocationRepository.findOne({ where: { _id: input.pickupLocationId! }, skipThrowError: true });
    if (!location) throw new NotFoundError("No such pickup location.");
  }

  const fulfilmentDraft = {
    mode: input.mode,
    address: input.mode === "DELIVERY" ? input.address : undefined,
    pickupLocationId: input.mode === "PICKUP" ? new mongoose.Types.ObjectId(input.pickupLocationId) : undefined,
  };

  const cart = await cartRepository.updateAtomic(
    cartFilterForActor(actor),
    { $set: { fulfilmentDraft } },
    { skipThrowError: true }
  );
  if (!cart) throw new NotFoundError("No cart exists yet — add a line first.");

  const lines = await cartLineRepository.findAll({ where: { cartId: cart._id }, sort: CART_LINE_ORDER });
  return toCartView(cart, lines);
}
