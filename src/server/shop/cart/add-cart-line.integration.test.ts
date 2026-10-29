// @vitest-environment node
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { VariantModel } from "../../catalog/variant.schema";
import { CartLineModel } from "../../commerce/cart-line.schema";
import { CartModel } from "../../commerce/cart.schema";
import type { ShopActor } from "../shop-actor";
import { addCartLine } from "./add-cart-line";

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
  await VariantModel.deleteMany({});
  await mongoose.disconnect();
});

/** Matches `reserve-stock.integration.test.ts`'s own precedent: a Variant needs no real Product to exist for a cart test. */
async function createVariant() {
  const doc = await VariantModel.create({
    productId: new mongoose.Types.ObjectId(),
    sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
    variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    price: toMoney("10.00"),
    stock: 100,
  });
  return doc._id as mongoose.Types.ObjectId;
}

function customerActor(): { actor: ShopActor; customerId: mongoose.Types.ObjectId } {
  const customerId = new mongoose.Types.ObjectId();
  return { actor: { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } }, customerId };
}

describe("addCartLine", () => {
  it("rejects an unknown variant", async () => {
    const { actor } = customerActor();
    await expect(addCartLine(actor, { variantId: new mongoose.Types.ObjectId().toString(), quantity: 1 })).rejects.toThrow(
      /No such product variant/
    );
  });

  it("creates the cart on first add for a signed-in customer", async () => {
    const variantId = await createVariant();
    const { actor } = customerActor();

    const view = await addCartLine(actor, { variantId: variantId.toString(), quantity: 2 });

    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]?.quantity).toBe(2);
    expect(view.cartToken).toBeUndefined();
    expect(await CartModel.countDocuments({})).toBe(1);
  });

  it("mints a fresh cart token for a guest with none, and returns it", async () => {
    const variantId = await createVariant();

    const view = await addCartLine({ kind: "guest", cartToken: null }, { variantId: variantId.toString(), quantity: 1 });

    expect(view.cartToken).toBeTruthy();
    const stored = await CartModel.findOne({ cartToken: view.cartToken }).lean();
    expect(await CartLineModel.countDocuments({ cartId: stored?._id })).toBe(1);
  });

  it("reuses an existing cart when the guest already presents a token", async () => {
    const variantId = await createVariant();
    const first = await addCartLine({ kind: "guest", cartToken: null }, { variantId: variantId.toString(), quantity: 1 });
    const token = first.cartToken!;

    const second = await addCartLine({ kind: "guest", cartToken: token }, { variantId: variantId.toString(), quantity: 1, note: "gift wrap" });

    expect(second.cartToken).toBe(token);
    expect(second.lines).toHaveLength(2);
    expect(await CartModel.countDocuments({})).toBe(1);
  });

  it("does not adopt an unknown client-supplied cart token: unknown token in, different server token out", async () => {
    const variantId = await createVariant();

    const view = await addCartLine({ kind: "guest", cartToken: "planted-by-attacker" }, { variantId: variantId.toString(), quantity: 1 });

    expect(view.cartToken).toBeTruthy();
    expect(view.cartToken).not.toBe("planted-by-attacker");
    expect(await CartModel.countDocuments({ cartToken: "planted-by-attacker" })).toBe(0);
  });

  describe("cart-line identity: (variantId, normalizedNote)", () => {
    it("merges two adds of the same variant with no note into one line, summing quantity", async () => {
      const variantId = await createVariant();
      const { actor } = customerActor();

      await addCartLine(actor, { variantId: variantId.toString(), quantity: 2 });
      const view = await addCartLine(actor, { variantId: variantId.toString(), quantity: 3 });

      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]?.quantity).toBe(5);
    });

    it("merges two adds whose notes differ only by whitespace — normalization collapses them to the same identity", async () => {
      const variantId = await createVariant();
      const { actor } = customerActor();

      await addCartLine(actor, { variantId: variantId.toString(), quantity: 1, note: "  Gift wrap  " });
      const view = await addCartLine(actor, { variantId: variantId.toString(), quantity: 1, note: "Gift wrap" });

      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]?.quantity).toBe(2);
      expect(view.lines[0]?.note).toBe("Gift wrap");
    });

    it("treats a whitespace-only note the same as no note at all", async () => {
      const variantId = await createVariant();
      const { actor } = customerActor();

      await addCartLine(actor, { variantId: variantId.toString(), quantity: 1 });
      const view = await addCartLine(actor, { variantId: variantId.toString(), quantity: 1, note: "   " });

      expect(view.lines).toHaveLength(1);
      expect(view.lines[0]?.quantity).toBe(2);
      expect(view.lines[0]?.note).toBeUndefined();
    });

    it("keeps a genuinely different note as a SEPARATE line for the same variant", async () => {
      const variantId = await createVariant();
      const { actor } = customerActor();

      await addCartLine(actor, { variantId: variantId.toString(), quantity: 1, note: "no onions" });
      const view = await addCartLine(actor, { variantId: variantId.toString(), quantity: 1, note: "extra spicy" });

      expect(view.lines).toHaveLength(2);
      expect(view.lines.map((l) => l.note).sort()).toEqual(["extra spicy", "no onions"]);
    });
  });

  describe("concurrency safety", () => {
    it("10 concurrent adds of the SAME identity merge into exactly one line with the correctly summed quantity — no lost updates", async () => {
      const variantId = await createVariant();
      const { actor, customerId } = customerActor();

      // Seed the cart first so all 10 requests race the MERGE step, not the
      // cart-creation step — isolating exactly the concern raised in scope
      // review: concurrent add-line calls against an EXISTING cart.
      await addCartLine(actor, { variantId: variantId.toString(), quantity: 1 });

      await Promise.all(
        Array.from({ length: 10 }, () => addCartLine(actor, { variantId: variantId.toString(), quantity: 1 }))
      );

      const cart = await CartModel.findOne({ customerId }).lean();
      const storedLines = await CartLineModel.find({ cartId: cart?._id }).lean();
      expect(storedLines).toHaveLength(1);
      expect(storedLines[0]?.quantity).toBe(11); // 1 seed + 10 concurrent
    });

    it("concurrent adds of DIFFERENT identities on the same cart all land as separate lines — no lost appends", async () => {
      const { actor, customerId } = customerActor();
      const variantIds = await Promise.all([createVariant(), createVariant(), createVariant(), createVariant(), createVariant()]);

      await Promise.all(variantIds.map((variantId) => addCartLine(actor, { variantId: variantId.toString(), quantity: 1 })));

      const cart = await CartModel.findOne({ customerId }).lean();
      const storedLines = await CartLineModel.find({ cartId: cart?._id }).lean();
      expect(storedLines).toHaveLength(5);
      expect(new Set(storedLines.map((l) => l.variantId.toString())).size).toBe(5);
    });
  });
});
