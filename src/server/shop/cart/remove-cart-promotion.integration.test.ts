// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CartModel } from "../../commerce/cart.schema";
import type { ShopActor } from "../shop-actor";
import { removeCartPromotion } from "./remove-cart-promotion";

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

function actorFor(customerId: mongoose.Types.ObjectId): ShopActor {
  return { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };
}

describe("removeCartPromotion", () => {
  it("clears an applied code", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId, appliedPromotionCode: "SAVE10" });

    const view = await removeCartPromotion(actorFor(customerId));

    expect(view.appliedPromotionCode).toBeUndefined();
  });

  it("is idempotent — clearing an already-absent code is a harmless no-op", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });

    await expect(removeCartPromotion(actorFor(customerId))).resolves.toEqual(
      expect.objectContaining({ appliedPromotionCode: undefined })
    );
  });

  it("rejects when no cart exists yet", async () => {
    await expect(removeCartPromotion(actorFor(new mongoose.Types.ObjectId()))).rejects.toThrow(/No cart exists/);
  });
});
