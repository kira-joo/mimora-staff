// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { buildCartLineIdentityKey, CartLineModel } from "../commerce/cart-line.schema";
import { CartModel } from "../commerce/cart.schema";
import { getCart } from "./get-cart";

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

describe("getCart", () => {
  it("returns an empty cart for a guest with no cart token — no document is created on read", async () => {
    const view = await getCart({ kind: "guest", cartToken: null });
    expect(view).toEqual({ lines: [] });
    expect(await CartModel.countDocuments({})).toBe(0);
  });

  it("returns an empty cart for a guest whose cart token matches nothing yet", async () => {
    const view = await getCart({ kind: "guest", cartToken: "unknown-token" });
    expect(view).toEqual({ lines: [] });
  });

  it("returns the guest's real cart when the token matches", async () => {
    const cart = await CartModel.create({ cartToken: "real-token", appliedPromotionCode: "SAVE10" });
    const variantId = new mongoose.Types.ObjectId();
    await CartLineModel.create({
      cartId: cart._id,
      variantId,
      quantity: 2,
      lineIdentityKey: buildCartLineIdentityKey(cart._id, variantId, undefined),
    });

    const view = await getCart({ kind: "guest", cartToken: "real-token" });
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]?.quantity).toBe(2);
    expect(view.appliedPromotionCode).toBe("SAVE10");
  });

  it("returns an empty cart for a customer who has never added a line", async () => {
    const view = await getCart({ kind: "customer", customer: { _id: new mongoose.Types.ObjectId().toString(), name: "x", phone: "x" } });
    expect(view).toEqual({ lines: [] });
  });

  it("returns the customer's own cart by customerId", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const cart = await CartModel.create({ customerId });
    const variantId = new mongoose.Types.ObjectId();
    await CartLineModel.create({
      cartId: cart._id,
      variantId,
      quantity: 1,
      lineIdentityKey: buildCartLineIdentityKey(cart._id, variantId, undefined),
    });

    const view = await getCart({ kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } });
    expect(view.lines).toHaveLength(1);
  });
});
