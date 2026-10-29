import { toMoney } from "@kira-joo/toolkit-common";
// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { PromotionModel } from "../commerce/promotion.schema";
import { getActivePromotions } from "./get-active-promotions";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await PromotionModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

const NOW = new Date(2026, 5, 15);

async function seedPromotion(overrides: { active?: boolean; startsAt?: Date; endsAt?: Date; code?: string } = {}) {
  return PromotionModel.create({
    code: overrides.code,
    name: { en: "x", ar: "x" },
    description: { en: "x", ar: "x" },
    type: "PERCENT",
    value: toMoney("10"),
    conditions: { startsAt: overrides.startsAt, endsAt: overrides.endsAt, categories: [], collections: [], products: [], variants: [], firstOrderOnly: false },
    active: overrides.active ?? true,
  });
}

describe("getActivePromotions", () => {
  it("includes a promotion with no date bounds at all", async () => {
    await seedPromotion({});
    expect(await getActivePromotions(NOW)).toHaveLength(1);
  });

  it("excludes an inactive promotion regardless of its date window", async () => {
    await seedPromotion({ active: false });
    expect(await getActivePromotions(NOW)).toHaveLength(0);
  });

  it("excludes a promotion that has not started yet", async () => {
    await seedPromotion({ startsAt: new Date(2026, 5, 20) });
    expect(await getActivePromotions(NOW)).toHaveLength(0);
  });

  it("excludes a promotion that has already ended", async () => {
    await seedPromotion({ endsAt: new Date(2026, 5, 10) });
    expect(await getActivePromotions(NOW)).toHaveLength(0);
  });

  it("includes a promotion currently inside its start/end window", async () => {
    await seedPromotion({ startsAt: new Date(2026, 5, 1), endsAt: new Date(2026, 5, 30) });
    expect(await getActivePromotions(NOW)).toHaveLength(1);
  });

  it("includes a promotion with only a startsAt in the past and no endsAt", async () => {
    await seedPromotion({ startsAt: new Date(2026, 0, 1) });
    expect(await getActivePromotions(NOW)).toHaveLength(1);
  });

  it("includes a promotion with only an endsAt in the future and no startsAt", async () => {
    await seedPromotion({ endsAt: new Date(2026, 11, 31) });
    expect(await getActivePromotions(NOW)).toHaveLength(1);
  });

  it("never lists a coded promotion, even one that is active and inside its window", async () => {
    await seedPromotion({ code: "SECRET" });
    await seedPromotion({});
    const result = await getActivePromotions(NOW);
    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("projects the scope as public catalog ids — an unrestricted promotion reaches the whole catalogue", async () => {
    await seedPromotion({});
    const [view] = await getActivePromotions(NOW);
    expect(view?.scope).toEqual({ all: true, categoryIds: [], collectionIds: [], productIds: [], variantRestricted: false });
  });

  it("a scoped promotion is never reported as applying to everything, and never leaks variant ids or limits", async () => {
    const category = new mongoose.Types.ObjectId();
    const variant = new mongoose.Types.ObjectId();
    await PromotionModel.create({
      name: { en: "Shirts", ar: "قمصان" },
      description: { en: "x", ar: "x" },
      type: "PERCENT",
      value: toMoney("10"),
      conditions: { categories: [category], collections: [], products: [], variants: [variant], firstOrderOnly: false },
      limits: { totalUses: 5, perCustomerUses: 1 },
    });
    const [view] = await getActivePromotions(NOW);
    expect(view?.scope).toEqual({ all: false, categoryIds: [category.toString()], collectionIds: [], productIds: [], variantRestricted: true });
    const wire = JSON.stringify(view);
    expect(wire).not.toContain(variant.toString());
    expect(wire).not.toContain("totalUses");
    expect(wire).not.toContain("usageCount");
  });

  it("never lists a first-order-only promotion — whether it applies depends on who is looking", async () => {
    await PromotionModel.create({
      name: { en: "First", ar: "الأولى" },
      description: { en: "x", ar: "x" },
      type: "PERCENT",
      value: toMoney("15"),
      conditions: { categories: [], collections: [], products: [], variants: [], firstOrderOnly: true },
    });
    await seedPromotion({});
    expect(await getActivePromotions(NOW)).toHaveLength(1);
  });

  it("a promotion restricted to variants only is not 'all' either", async () => {
    await PromotionModel.create({
      name: { en: "V", ar: "V" },
      description: { en: "x", ar: "x" },
      type: "FIXED",
      value: toMoney("5"),
      conditions: { categories: [], collections: [], products: [], variants: [new mongoose.Types.ObjectId()], firstOrderOnly: false },
    });
    const [view] = await getActivePromotions(NOW);
    expect(view?.scope.all).toBe(false);
    expect(view?.scope.variantRestricted).toBe(true);
  });
});
