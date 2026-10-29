import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import type { PromotionSchema } from "./promotion.schema";
import { toEvaluablePromotion } from "./promotion-evaluable";

const id = () => new mongoose.Types.ObjectId();

function stored(overrides: Partial<PromotionSchema> = {}): PromotionSchema {
  return {
    _id: id(),
    name: { en: "", ar: "" },
    description: { en: "", ar: "" },
    type: "FIXED",
    value: toMoney("15.50"),
    conditions: { categories: [id()], collections: [], products: [], variants: [], firstOrderOnly: false },
    limits: {},
    usageCount: 0,
    stackable: false,
    active: true,
    ...overrides,
  } as PromotionSchema;
}

describe("toEvaluablePromotion", () => {
  it("passes an exact decimal value through as Money", () => {
    expect(toEvaluablePromotion(stored()).value?.toFixed(2)).toBe("15.50");
  });

  it("converts a value saved as a plain Number (before it became a decimal) exactly once, at the boundary", () => {
    const legacy = stored({ value: 15.5 as unknown as PromotionSchema["value"] });
    const value = toEvaluablePromotion(legacy).value;
    expect(value?.toFixed(2)).toBe("15.50");
    expect(typeof value).toBe("object");
  });

  it("gives FREE_SHIPPING (no value) no value", () => {
    expect(toEvaluablePromotion(stored({ type: "FREE_SHIPPING", value: undefined })).value).toBeUndefined();
  });

  it("drops null limits so the engine sees only real ones, and treats missing limits as none", () => {
    const limits = { totalUses: null, perCustomerUses: 3 } as unknown as PromotionSchema["limits"];
    expect(toEvaluablePromotion(stored({ limits })).limits).toEqual({ totalUses: undefined, perCustomerUses: 3 });
    expect(toEvaluablePromotion(stored({ limits: undefined as unknown as PromotionSchema["limits"] })).limits).toEqual({ totalUses: undefined, perCustomerUses: undefined });
  });

  it("stringifies scope ids for the engine", () => {
    const promotion = stored();
    expect(toEvaluablePromotion(promotion).conditions.categories).toEqual([promotion.conditions.categories[0]!.toString()]);
  });
});
