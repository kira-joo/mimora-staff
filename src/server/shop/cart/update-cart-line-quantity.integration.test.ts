// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { buildCartLineIdentityKey, CartLineModel } from "../../commerce/cart-line.schema";
import { CartModel } from "../../commerce/cart.schema";
import type { ShopActor } from "../shop-actor";
import { updateCartLineQuantity } from "./update-cart-line-quantity";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CartModel.deleteMany({});
  await CartLineModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function createLine(cartId: mongoose.Types.ObjectId, quantity = 1) {
  const variantId = new mongoose.Types.ObjectId();
  return CartLineModel.create({ cartId, variantId, quantity, lineIdentityKey: buildCartLineIdentityKey(cartId, variantId, undefined) });
}

describe("updateCartLineQuantity", () => {
  it("sets an absolute quantity on the matching line", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const cart = await CartModel.create({ customerId });
    const line = await createLine(cart._id, 1);
    const actor: ShopActor = { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };

    const view = await updateCartLineQuantity(actor, line._id.toString(), 9);

    expect(view.lines[0]?.quantity).toBe(9);
  });

  it("is idempotent — repeating the same PUT sets the identical end state", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const cart = await CartModel.create({ customerId });
    const line = await createLine(cart._id, 1);
    const actor: ShopActor = { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };

    await updateCartLineQuantity(actor, line._id.toString(), 5);
    const view = await updateCartLineQuantity(actor, line._id.toString(), 5);

    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]?.quantity).toBe(5);
  });

  it("rejects a lineId that does not exist in this actor's cart", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });
    const actor: ShopActor = { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };

    await expect(updateCartLineQuantity(actor, new mongoose.Types.ObjectId().toString(), 3)).rejects.toThrow(/No such line/);
  });

  it("rejects a lineId that belongs to a DIFFERENT actor's cart — ownership, not just existence", async () => {
    const ownerCustomerId = new mongoose.Types.ObjectId();
    const cart = await CartModel.create({ customerId: ownerCustomerId });
    const line = await createLine(cart._id, 1);

    const attacker: ShopActor = { kind: "customer", customer: { _id: new mongoose.Types.ObjectId().toString(), name: "x", phone: "x" } };
    await expect(updateCartLineQuantity(attacker, line._id.toString(), 99)).rejects.toThrow(/No such line/);

    const untouched = await CartLineModel.findById(line._id).lean();
    expect(untouched?.quantity).toBe(1);
  });
});
