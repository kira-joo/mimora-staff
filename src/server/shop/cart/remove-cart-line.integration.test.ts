// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { buildCartLineIdentityKey, CartLineModel } from "../../commerce/cart-line.schema";
import { CartModel } from "../../commerce/cart.schema";
import type { ShopActor } from "../shop-actor";
import { removeCartLine } from "./remove-cart-line";

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

async function createLine(cartId: mongoose.Types.ObjectId, note?: string) {
  const variantId = new mongoose.Types.ObjectId();
  return CartLineModel.create({
    cartId,
    variantId,
    quantity: 1,
    note,
    lineIdentityKey: buildCartLineIdentityKey(cartId, variantId, note),
  });
}

describe("removeCartLine", () => {
  it("removes the matching line", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const cart = await CartModel.create({ customerId });
    const lineToRemove = await createLine(cart._id, "keep this note distinct");
    const otherLine = await createLine(cart._id, "a different note");
    const actor: ShopActor = { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };

    const view = await removeCartLine(actor, lineToRemove._id.toString());

    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]?.lineId).toBe(otherLine._id.toString());
  });

  it("is idempotent — removing an already-removed line is a no-op, not an error", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });
    const actor: ShopActor = { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };

    await expect(removeCartLine(actor, new mongoose.Types.ObjectId().toString())).resolves.toEqual(
      expect.objectContaining({ lines: [] })
    );
  });

  it("rejects when no cart exists for this actor at all", async () => {
    const actor: ShopActor = { kind: "customer", customer: { _id: new mongoose.Types.ObjectId().toString(), name: "x", phone: "x" } };
    await expect(removeCartLine(actor, new mongoose.Types.ObjectId().toString())).rejects.toThrow(/No cart exists/);
  });
});
