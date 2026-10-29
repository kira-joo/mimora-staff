import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import type { ShopActor } from "../shop-actor";

/**
 * The one Mongo filter every Cart mutation in this batch uses to find
 * "the actor's own cart" — `customerId` for a signed-in customer,
 * `cartToken` for a guest. Never a client-supplied cart id: a route never
 * even accepts one, so there is nothing for a client to substitute another
 * actor's cart into.
 *
 * @throws {UnauthorizedError} A guest presented no cart token at all — there is no cart this request could possibly own.
 */
export function cartFilterForActor(actor: ShopActor): Record<string, unknown> {
  if (actor.kind === "customer") {
    return { customerId: new mongoose.Types.ObjectId(actor.customer._id) };
  }

  if (!actor.cartToken) {
    throw new UnauthorizedError("No cart to update yet — add a line first.");
  }

  return { cartToken: actor.cartToken };
}
