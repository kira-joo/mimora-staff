// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CartModel } from "../../commerce/cart.schema";
import type { ShopActor } from "../shop-actor";
import { ensureCart } from "./ensure-cart";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CartModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("ensureCart", () => {
  it("creates a cart for a customer with none yet", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const actor: ShopActor = { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };

    const { cart, mintedCartToken } = await ensureCart(actor);

    expect(cart.customerId?.toString()).toBe(customerId.toString());
    expect(mintedCartToken).toBeUndefined();
  });

  it("reuses an existing cart rather than creating a second one", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const actor: ShopActor = { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };

    const first = await ensureCart(actor);
    const second = await ensureCart(actor);

    expect(second.cart._id.toString()).toBe(first.cart._id.toString());
    expect(await CartModel.countDocuments({ customerId })).toBe(1);
  });

  it(
    "20 concurrent first-ever ensureCart calls for the SAME customer create exactly one Cart document — " +
      "the @Unique(sparse) index on customerId plus the duplicate-key catch-and-reread makes this safe, not merely likely",
    async () => {
      const customerId = new mongoose.Types.ObjectId();
      const actor: ShopActor = { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };

      const results = await Promise.all(Array.from({ length: 20 }, () => ensureCart(actor)));

      const distinctCartIds = new Set(results.map((r) => r.cart._id.toString()));
      expect(distinctCartIds.size).toBe(1);
      expect(await CartModel.countDocuments({ customerId })).toBe(1);
    }
  );

  it("mints a fresh cart token for a guest with none, and creates a cart with it", async () => {
    const { cart, mintedCartToken } = await ensureCart({ kind: "guest", cartToken: null });

    expect(mintedCartToken).toBeTruthy();
    expect(cart.cartToken).toBe(mintedCartToken);
  });

  it("reuses an existing cart for a guest who already presents a token, without minting a new one", async () => {
    const first = await ensureCart({ kind: "guest", cartToken: null });
    const token = first.mintedCartToken!;

    const second = await ensureCart({ kind: "guest", cartToken: token });

    expect(second.mintedCartToken).toBeUndefined();
    expect(second.cart._id.toString()).toBe(first.cart._id.toString());
  });

  it("never adopts a client-supplied token that matches no cart — it mints a fresh one instead (fixation)", async () => {
    const planted = "attacker-chosen-token";

    const { cart, mintedCartToken } = await ensureCart({ kind: "guest", cartToken: planted });

    expect(mintedCartToken).toBeTruthy();
    expect(mintedCartToken).not.toBe(planted);
    expect(cart.cartToken).toBe(mintedCartToken);
    expect(await CartModel.countDocuments({ cartToken: planted })).toBe(0);
  });
});
