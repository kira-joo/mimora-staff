import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { PromotionModel } from "../../commerce/promotion.schema";
import { listPromotions } from "./list-promotions";
import { createPromotion } from "./create-promotion";
import { updatePromotion } from "./update-promotion";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "نص", en: "Text" };

describe("Admin Promotions", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await PromotionModel.deleteMany({});
  });

  // get-active-promotions.integration.test.ts shares this collection and
  // relies on afterEach (not beforeEach) cleanup, i.e. an empty collection
  // on entry — leaving this file's own last document behind would corrupt
  // whichever suite runs next.
  afterEach(async () => {
    await PromotionModel.deleteMany({});
  });

  describe("createPromotion", () => {
    it("creates a coded PERCENT promotion", async () => {
      const promotion = await createPromotion({
        code: "SAVE10",
        name: LOCALIZED,
        description: LOCALIZED,
        type: "PERCENT",
        value: toMoney("10"),
        conditions: {},
      });

      expect(promotion.code).toBe("SAVE10");
      expect(promotion.active).toBe(true);
      expect(promotion.conditions.categories).toEqual([]);
    });

    it("creates a codeless (automatic) promotion", async () => {
      const promotion = await createPromotion({
        name: LOCALIZED,
        description: LOCALIZED,
        type: "FREE_SHIPPING",
        value: toMoney("0"),
        conditions: { minSubtotal: toMoney("50.00") },
      });

      expect(promotion.code).toBeUndefined();
      expect(promotion.conditions.minSubtotal?.toFixed(2)).toBe("50.00");
    });

    it("throws ConflictError when a PERCENT value exceeds 100", async () => {
      await expect(
        createPromotion({ name: LOCALIZED, description: LOCALIZED, type: "PERCENT", value: toMoney("150"), conditions: {} })
      ).rejects.toThrow(ConflictError);
    });

    it("throws ConflictError on duplicate code (case-insensitive)", async () => {
      await createPromotion({ code: "SAVE10", name: LOCALIZED, description: LOCALIZED, type: "PERCENT", value: toMoney("10"), conditions: {} });

      await expect(
        createPromotion({ code: "save10", name: LOCALIZED, description: LOCALIZED, type: "FIXED", value: toMoney("5"), conditions: {} })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("updatePromotion", () => {
    it("updates fields and deactivates", async () => {
      const created = await createPromotion({ code: "OLD", name: LOCALIZED, description: LOCALIZED, type: "PERCENT", value: toMoney("10"), conditions: {} });

      const updated = await updatePromotion(created._id.toString(), { active: false, value: toMoney("20") });
      expect(updated.active).toBe(false);
      expect(updated.value?.toString()).toBe("20");
    });

    it("throws ConflictError raising value above 100 for a PERCENT promotion", async () => {
      const created = await createPromotion({ name: LOCALIZED, description: LOCALIZED, type: "PERCENT", value: toMoney("10"), conditions: {} });

      await expect(updatePromotion(created._id.toString(), { value: toMoney("200") })).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent promotion", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(updatePromotion(fakeId, { active: false })).rejects.toThrow(NotFoundError);
    });
  });

  describe("listPromotions", () => {
    it("filters by active and type", async () => {
      await createPromotion({ code: "A", name: LOCALIZED, description: LOCALIZED, type: "PERCENT", value: toMoney("10"), conditions: {}, active: true });
      await createPromotion({ code: "B", name: LOCALIZED, description: LOCALIZED, type: "FIXED", value: toMoney("5"), conditions: {}, active: false });

      const active = await listPromotions({ limit: 10, page: 1, active: true });
      expect(active.total).toBe(1);

      const percent = await listPromotions({ limit: 10, page: 1, type: "PERCENT" });
      expect(percent.total).toBe(1);
    });
  });
});
