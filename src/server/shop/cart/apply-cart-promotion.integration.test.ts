// @vitest-environment node
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CartModel } from "../../commerce/cart.schema";
import { PromotionModel } from "../../commerce/promotion.schema";
import type { ShopActor } from "../shop-actor";
import { applyCartPromotion } from "./apply-cart-promotion";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CartModel.deleteMany({});
  await PromotionModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

function actorFor(customerId: mongoose.Types.ObjectId): ShopActor {
  return { kind: "customer", customer: { _id: customerId.toString(), name: "x", phone: "x" } };
}

async function createPromotion(overrides: Partial<{ code: string; active: boolean; startsAt: Date; endsAt: Date }> = {}) {
  return PromotionModel.create({
    code: overrides.code ?? `SAVE${new mongoose.Types.ObjectId().toString()}`,
    name: { en: "x", ar: "x" },
    description: { en: "x", ar: "x" },
    type: "PERCENT",
    value: toMoney("10"),
    conditions: {
      startsAt: overrides.startsAt,
      endsAt: overrides.endsAt,
      categories: [],
      collections: [],
      products: [],
      variants: [],
      firstOrderOnly: false,
    },
    active: overrides.active ?? true,
  });
}

describe("applyCartPromotion", () => {
  it("applies a currently-active code", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });
    await createPromotion({ code: "SAVE10" });

    const view = await applyCartPromotion(actorFor(customerId), "SAVE10");

    expect(view.appliedPromotionCode).toBe("SAVE10");
  });

  it("normalizes the code — lowercase input still matches the uppercase-stored code", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });
    await createPromotion({ code: "SAVE10" });

    const view = await applyCartPromotion(actorFor(customerId), "  save10  ");

    expect(view.appliedPromotionCode).toBe("SAVE10");
  });

  it("rejects an unknown code", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });

    await expect(applyCartPromotion(actorFor(customerId), "NOSUCHCODE")).rejects.toThrow(/not currently valid/);
  });

  it("rejects a code that is marked inactive", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });
    await createPromotion({ code: "OFF10", active: false });

    await expect(applyCartPromotion(actorFor(customerId), "OFF10")).rejects.toThrow(/not currently valid/);
  });

  it("rejects a code whose date window has not started yet", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });
    await createPromotion({ code: "FUTURE10", startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });

    await expect(applyCartPromotion(actorFor(customerId), "FUTURE10")).rejects.toThrow(/not currently valid/);
  });

  it("rejects a code whose date window has already ended", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });
    await createPromotion({ code: "EXPIRED10", endsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });

    await expect(applyCartPromotion(actorFor(customerId), "EXPIRED10")).rejects.toThrow(/not currently valid/);
  });

  it("does NOT evaluate eligibility (minSubtotal, scoping, usage limits) — that is Quote's job", async () => {
    const customerId = new mongoose.Types.ObjectId();
    await CartModel.create({ customerId });
    await PromotionModel.create({
      code: "HIGHMIN",
      name: { en: "x", ar: "x" },
      description: { en: "x", ar: "x" },
      type: "PERCENT",
      value: toMoney("10"),
      conditions: {
        minSubtotal: toMoney("10000.00"),
        categories: [],
        collections: [],
        products: [],
        variants: [],
        firstOrderOnly: false,
      },
      active: true,
    });

    // An empty cart can never meet a 10,000 minimum — still accepted here,
    // since existence/active/window is all this route checks.
    const view = await applyCartPromotion(actorFor(customerId), "HIGHMIN");
    expect(view.appliedPromotionCode).toBe("HIGHMIN");
  });

  it("rejects when no cart exists yet", async () => {
    await createPromotion({ code: "SAVE10" });
    await expect(applyCartPromotion(actorFor(new mongoose.Types.ObjectId()), "SAVE10")).rejects.toThrow(/No cart exists/);
  });
});
