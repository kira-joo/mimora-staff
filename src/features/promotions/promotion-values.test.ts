import { describe, expect, it } from "vitest";
import type { Promotion } from "src/api/promotions.endpoints";
import { codeProblem, dateWindowProblem, discountValueProblem, limitProblem, mapPromotionToFormValues, minSubtotalProblem, promotionToBody } from "./promotion-values";

const saved: Promotion = {
  _id: "1",
  code: "SAVE10",
  name: { ar: "خصم", en: "Save" },
  description: { ar: "", en: "" },
  type: "FIXED",
  value: "12.50",
  conditions: { minSubtotal: "100.00", categories: ["a"], collections: [], products: [], variants: ["v"], firstOrderOnly: true, startsAt: "2026-10-01T00:00:00.000Z" },
  limits: { totalUses: 5 },
  usageCount: 2,
  stackable: true,
  active: false,
};

describe("mapPromotionToFormValues", () => {
  it("gives create defaults", () => {
    const v = mapPromotionToFormValues();
    expect(v).toMatchObject({ type: "PERCENT", value: "", active: true, code: "", categories: [], startsAt: "" });
  });
  it("maps a saved promotion to strings", () => {
    expect(mapPromotionToFormValues(saved)).toMatchObject({ value: "12.50", minSubtotal: "100.00", totalUses: "5", perCustomerUses: "", active: false, variants: ["v"] });
  });
  it("round-trips through the body without losing scope, and keeps the value a decimal string", () => {
    const body = promotionToBody(mapPromotionToFormValues(saved), true);
    expect(body.conditions).toMatchObject({ categories: ["a"], variants: ["v"], minSubtotal: "100.00", firstOrderOnly: true, endsAt: null });
    expect(body).not.toHaveProperty("stackable");
    expect(body.value).toBe("12.50");
    expect(body.limits).toEqual({ totalUses: 5, perCustomerUses: null });
  });
});

describe("promotionToBody", () => {
  it("on a create, omits every blank optional field and gives free shipping no value", () => {
    const body = promotionToBody({ ...mapPromotionToFormValues(), type: "FREE_SHIPPING", value: "99" }, false);
    expect(body.value).toBeUndefined();
    expect(body.code).toBeUndefined();
    expect(body.limits).toEqual({ totalUses: undefined, perCustomerUses: undefined });
    expect(body.conditions.minSubtotal).toBeUndefined();
    expect(body.conditions.startsAt).toBeUndefined();
  });

  it("on an edit, sends null for each blank optional field — the API's 'clear it'", () => {
    const cleared = { ...mapPromotionToFormValues(saved), code: " ", totalUses: "", minSubtotal: "", startsAt: "" };
    const body = promotionToBody(cleared, true);
    expect(body.code).toBeNull();
    expect(body.limits).toEqual({ totalUses: null, perCustomerUses: null });
    expect(body.conditions.minSubtotal).toBeNull();
    expect(body.conditions.startsAt).toBeNull();
  });

  it("on an edit to free shipping, clears the value", () => {
    expect(promotionToBody({ ...mapPromotionToFormValues(saved), type: "FREE_SHIPPING" }, true).value).toBeNull();
  });

  it("keeps zero as a value", () => {
    expect(promotionToBody({ ...mapPromotionToFormValues(), type: "FIXED", value: "0" }, false).value).toBe("0");
  });

  it("tolerates undefined numeric fields", () => {
    const body = promotionToBody({ ...mapPromotionToFormValues(), value: "10", totalUses: undefined as unknown as string }, false);
    expect(body.limits?.totalUses).toBeUndefined();
  });
});

describe("validation mirrors", () => {
  it("percent: 0-100 decimal", () => {
    expect(discountValueProblem("PERCENT", "100")).toBeUndefined();
    expect(discountValueProblem("PERCENT", "100.01")).toMatch(/exceed 100/);
    expect(discountValueProblem("PERCENT", "-5")).toBeDefined();
    expect(discountValueProblem("PERCENT", "")).toBe("Required");
  });
  it("fixed: money pattern", () => {
    expect(discountValueProblem("FIXED", "49.99")).toBeUndefined();
    expect(discountValueProblem("FIXED", "49.999")).toBeDefined();
    expect(discountValueProblem("FREE_SHIPPING", "")).toBeUndefined();
  });
  it("minimum subtotal optional but money-shaped", () => {
    expect(minSubtotalProblem("")).toBeUndefined();
    expect(minSubtotalProblem("1e3")).toBeDefined();
  });
  it("a limit may be blank (unlimited), else a whole number from 1", () => {
    expect(limitProblem("")).toBeUndefined();
    expect(limitProblem("0")).toBeDefined();
    expect(limitProblem("3")).toBeUndefined();
  });
  it("a code may be blank (automatic), else at most 50 characters", () => {
    expect(codeProblem("")).toBeUndefined();
    expect(codeProblem("x".repeat(51))).toBeDefined();
  });
  it("window end must follow start", () => {
    expect(dateWindowProblem("2026-10-02T00:00:00Z", "2026-10-01T00:00:00Z")).toBeDefined();
    expect(dateWindowProblem("", "2026-10-01T00:00:00Z")).toBeUndefined();
  });
});
