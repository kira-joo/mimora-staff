import { MONEY_SCALE, toMoney, type Money } from "@kira-joo/toolkit-common";
import { describe, expect, it } from "vitest";
import { evaluatePromotion, selectBestPromotion } from "./evaluate-promotion";
import type { EvaluablePromotion, PromotionContext } from "./evaluate-promotion.types";

const NOW = new Date("2026-08-28T12:00:00Z");

/** Major units, as strings — see the note in calculate-pricing.test.ts. */
const m = (value: string) => toMoney(value);

const expectMoney = (actual: Money | undefined, expected: string) =>
  expect(actual?.toFixed(MONEY_SCALE)).toBe(expected);

function promotion(overrides: Partial<EvaluablePromotion> = {}): EvaluablePromotion {
  return {
    type: "PERCENT",
    value: m("20"),
    active: true,
    conditions: {
      categories: [],
      collections: [],
      products: [],
      variants: [],
      firstOrderOnly: false,
    },
    limits: {},
    usageCount: 0,
    stackable: false,
    ...overrides,
  };
}

function context(overrides: Partial<PromotionContext> = {}): PromotionContext {
  return {
    now: NOW,
    subtotal: m("100.00"),
    lines: [{ categoryId: "electronics", collectionIds: [], productId: "phone-x", variantId: "phone-x-black", lineTotal: m("100.00") }],
    isFirstOrder: false,
    customerUses: 0,
    ...overrides,
  };
}

describe("discount value", () => {
  it("computes a percentage of the eligible subtotal", () => {
    const result = evaluatePromotion(promotion({ value: m("20") }), context());
    expect(result.applicable).toBe(true);
    if (result.applicable) expectMoney(result.effect.subtotalDiscount, "20.00");
  });

  it("computes a fixed amount", () => {
    const result = evaluatePromotion(promotion({ type: "FIXED", value: m("15") }), context());
    if (result.applicable) expectMoney(result.effect.subtotalDiscount, "15.00");
  });

  it("caps a fixed amount at the eligible subtotal", () => {
    const result = evaluatePromotion(
      promotion({
        type: "FIXED",
        value: m("999.99"),
        conditions: { categories: ["accessories"], collections: [], products: [], variants: [], firstOrderOnly: false },
      }),
      context({
        subtotal: m("100.00"),
        lines: [
          { categoryId: "electronics", collectionIds: [], productId: "phone-x", variantId: "phone-x-black", lineTotal: m("80.00") },
          { categoryId: "accessories", collectionIds: [], productId: "case", variantId: "case-clear", lineTotal: m("20.00") },
        ],
      })
    );

    if (result.applicable) expectMoney(result.effect.subtotalDiscount, "20.00");
  });

  it("reads a fixed value as MAJOR units and keeps its fractional part", () => {
    const result = evaluatePromotion(promotion({ type: "FIXED", value: m("15.5") }), context());
    if (result.applicable) expectMoney(result.effect.subtotalDiscount, "15.50");
  });

  it("waives shipping without touching the subtotal", () => {
    const result = evaluatePromotion(promotion({ type: "FREE_SHIPPING" }), context());

    if (result.applicable) {
      expect(result.effect.waivesShippingFee).toBe(true);
      expectMoney(result.effect.subtotalDiscount, "0.00");
    }
  });

  it("clamps a nonsensical percentage rather than trusting it", () => {
    const over = evaluatePromotion(promotion({ value: m("500") }), context());
    if (over.applicable) expectMoney(over.effect.subtotalDiscount, "100.00");

    const under = evaluatePromotion(promotion({ value: m("-20") }), context());
    if (under.applicable) expectMoney(under.effect.subtotalDiscount, "0.00");
  });
});

describe("scoping conditions — category, collection, product, variant", () => {
  const mixedBasket = context({
    subtotal: m("100.00"),
    lines: [
      { categoryId: "electronics", collectionIds: ["summer-sale"], productId: "phone-x", variantId: "phone-x-black", lineTotal: m("80.00") },
      { categoryId: "accessories", collectionIds: [], productId: "case", variantId: "case-clear", lineTotal: m("20.00") },
    ],
  });

  it("discounts only lines matching the category condition", () => {
    const result = evaluatePromotion(
      promotion({
        value: m("50"),
        conditions: { categories: ["accessories"], collections: [], products: [], variants: [], firstOrderOnly: false },
      }),
      mixedBasket
    );
    if (result.applicable) {
      expectMoney(result.eligibleSubtotal, "20.00");
      expectMoney(result.effect.subtotalDiscount, "10.00");
    }
  });

  it("matches on a collection condition", () => {
    const result = evaluatePromotion(
      promotion({
        value: m("10"),
        conditions: { categories: [], collections: ["summer-sale"], products: [], variants: [], firstOrderOnly: false },
      }),
      mixedBasket
    );
    if (result.applicable) expectMoney(result.eligibleSubtotal, "80.00");
  });

  it("matches on a product condition", () => {
    const result = evaluatePromotion(
      promotion({
        value: m("10"),
        conditions: { categories: [], collections: [], products: ["case"], variants: [], firstOrderOnly: false },
      }),
      mixedBasket
    );
    if (result.applicable) expectMoney(result.eligibleSubtotal, "20.00");
  });

  it("matches on a variant condition", () => {
    const result = evaluatePromotion(
      promotion({
        value: m("10"),
        conditions: { categories: [], collections: [], products: [], variants: ["case-clear"], firstOrderOnly: false },
      }),
      mixedBasket
    );
    if (result.applicable) expectMoney(result.eligibleSubtotal, "20.00");
  });

  it("rejects a basket with no eligible items", () => {
    const result = evaluatePromotion(
      promotion({
        conditions: { categories: ["accessories"], collections: [], products: [], variants: [], firstOrderOnly: false },
      }),
      context({ lines: [{ categoryId: "electronics", collectionIds: [], productId: "phone-x", variantId: "phone-x-black", lineTotal: m("100.00") }] })
    );
    expect(result).toMatchObject({ applicable: false, rejection: "NO_ELIGIBLE_ITEMS" });
  });

  it("treats every condition array empty as no restriction", () => {
    // An unset restriction must not become a restriction.
    const result = evaluatePromotion(promotion({ value: m("10") }), mixedBasket);
    if (result.applicable) expectMoney(result.eligibleSubtotal, "100.00");
  });
});

describe("rejections always name a cause", () => {
  it("reports an inactive promotion", () => {
    expect(evaluatePromotion(promotion({ active: false }), context())).toMatchObject({ rejection: "INACTIVE" });
  });

  it("reports a promotion that has not started or has expired", () => {
    expect(
      evaluatePromotion(
        promotion({
          conditions: { categories: [], collections: [], products: [], variants: [], firstOrderOnly: false, startsAt: new Date("2026-09-01T00:00:00Z") },
        }),
        context()
      )
    ).toMatchObject({ rejection: "NOT_STARTED" });

    expect(
      evaluatePromotion(
        promotion({
          conditions: { categories: [], collections: [], products: [], variants: [], firstOrderOnly: false, endsAt: new Date("2026-08-01T00:00:00Z") },
        }),
        context()
      )
    ).toMatchObject({ rejection: "EXPIRED" });
  });

  it("reports a basket below the minimum", () => {
    expect(
      evaluatePromotion(
        promotion({
          conditions: { categories: [], collections: [], products: [], variants: [], firstOrderOnly: false, minSubtotal: m("200.00") },
        }),
        context({ subtotal: m("100.00") })
      )
    ).toMatchObject({ rejection: "BELOW_MINIMUM" });
  });

  it("checks the minimum against the WHOLE subtotal, not the eligible portion", () => {
    const result = evaluatePromotion(
      promotion({
        conditions: { categories: ["accessories"], collections: [], products: [], variants: [], firstOrderOnly: false, minSubtotal: m("100.00") },
      }),
      context({
        subtotal: m("100.00"),
        lines: [
          { categoryId: "electronics", collectionIds: [], productId: "phone-x", variantId: "phone-x-black", lineTotal: m("80.00") },
          { categoryId: "accessories", collectionIds: [], productId: "case", variantId: "case-clear", lineTotal: m("20.00") },
        ],
      })
    );

    expect(result.applicable).toBe(true);
  });

  it("reports a first-order-only promotion for a returning customer", () => {
    expect(
      evaluatePromotion(
        promotion({ conditions: { categories: [], collections: [], products: [], variants: [], firstOrderOnly: true } }),
        context({ isFirstOrder: false })
      )
    ).toMatchObject({ rejection: "NOT_FIRST_ORDER" });
  });

  it("reports both usage limits", () => {
    expect(evaluatePromotion(promotion({ limits: { totalUses: 100 }, usageCount: 100 }), context())).toMatchObject({
      rejection: "USAGE_LIMIT_REACHED",
    });

    expect(
      evaluatePromotion(promotion({ limits: { perCustomerUses: 1 } }), context({ customerUses: 1 }))
    ).toMatchObject({ rejection: "CUSTOMER_LIMIT_REACHED" });
  });

  it("allows a promotion still within its limits", () => {
    expect(
      evaluatePromotion(
        promotion({ limits: { totalUses: 100, perCustomerUses: 2 }, usageCount: 99 }),
        context({ customerUses: 1 })
      ).applicable
    ).toBe(true);
  });

  it("treats the boundary instants as inside the window", () => {
    const result = evaluatePromotion(
      promotion({
        conditions: { categories: [], collections: [], products: [], variants: [], firstOrderOnly: false, startsAt: NOW, endsAt: NOW },
      }),
      context()
    );
    expect(result.applicable).toBe(true);
  });
});

describe("selectBestPromotion", () => {
  const applicable = (discount: string, waivesShippingFee = false) => ({
    applicable: true as const,
    eligibleSubtotal: m("100.00"),
    effect: { subtotalDiscount: m(discount), waivesShippingFee },
  });

  it("picks the largest discount", () => {
    const best = selectBestPromotion(
      [
        { promotionId: "a", evaluation: applicable("5.00") },
        { promotionId: "b", evaluation: applicable("20.00") },
        { promotionId: "c", evaluation: applicable("10.00") },
      ],
      undefined
    );
    expect(best?.promotionId).toBe("b");
  });

  it("values free shipping at the fee it would waive", () => {
    const best = selectBestPromotion(
      [
        { promotionId: "percent", evaluation: applicable("10.00") },
        { promotionId: "freeShipping", evaluation: applicable("0.00", true) },
      ],
      m("15.00")
    );
    expect(best?.promotionId).toBe("freeShipping");
  });

  it("does not credit free shipping when no fee exists", () => {
    const best = selectBestPromotion(
      [
        { promotionId: "percent", evaluation: applicable("10.00") },
        { promotionId: "freeShipping", evaluation: applicable("0.00", true) },
      ],
      undefined
    );
    expect(best?.promotionId).toBe("percent");
  });

  it("compares candidates as Decimals, not through a float valueOf", () => {
    /*
     * `a > b` on two `Decimal`s coerces both through `valueOf()` and compares
     * doubles — right for almost every pair, silently wrong for the ones that
     * collide. The threshold is measured: collision starts at 1e15, the first
     * magnitude where a double runs out of significand for a hundredth.
     */
    const smaller = "1000000000000000.00";
    const larger = "1000000000000000.01";

    expect(Number(smaller) === Number(larger)).toBe(true);

    const best = selectBestPromotion(
      [
        { promotionId: "smaller", evaluation: applicable(smaller) },
        { promotionId: "larger", evaluation: applicable(larger) },
      ],
      undefined
    );

    expect(best?.promotionId).toBe("larger");
  });

  it("ignores inapplicable promotions and returns nothing when none apply", () => {
    expect(
      selectBestPromotion([{ promotionId: "a", evaluation: { applicable: false, rejection: "EXPIRED" } }], undefined)
    ).toBeUndefined();
    expect(selectBestPromotion([], undefined)).toBeUndefined();
  });
});

describe("usage limits — absent, null, numeric, exhausted", () => {
  it("absent means unlimited, however often it was used", () => {
    expect(evaluatePromotion(promotion({ limits: {}, usageCount: 10_000 }), context()).applicable).toBe(true);
  });

  it("a null limit (as an older record may hold) is no limit, never 'zero uses left'", () => {
    const limits = { totalUses: null, perCustomerUses: null } as unknown as EvaluablePromotion["limits"];
    expect(evaluatePromotion(promotion({ limits, usageCount: 5 }), context({ customerUses: 3 })).applicable).toBe(true);
  });

  it("applies while uses remain, and is exhausted exactly at the limit", () => {
    expect(evaluatePromotion(promotion({ limits: { totalUses: 1 }, usageCount: 0 }), context()).applicable).toBe(true);
    expect(evaluatePromotion(promotion({ limits: { totalUses: 1 }, usageCount: 1 }), context())).toEqual({ applicable: false, rejection: "USAGE_LIMIT_REACHED" });
  });

  it("applies the per-customer limit to that customer's own uses", () => {
    expect(evaluatePromotion(promotion({ limits: { perCustomerUses: 2 } }), context({ customerUses: 1 })).applicable).toBe(true);
    expect(evaluatePromotion(promotion({ limits: { perCustomerUses: 2 } }), context({ customerUses: 2 }))).toEqual({ applicable: false, rejection: "CUSTOMER_LIMIT_REACHED" });
  });
});

describe("exact decimal values", () => {
  it("a FIXED value of zero is a zero discount, not a missing one", () => {
    const result = evaluatePromotion(promotion({ type: "FIXED", value: m("0") }), context());
    expect(result.applicable && result.effect.subtotalDiscount.isZero()).toBe(true);
  });

  it("a PERCENT or FIXED promotion with no value discounts nothing rather than crashing", () => {
    for (const type of ["PERCENT", "FIXED"] as const) {
      const result = evaluatePromotion(promotion({ type, value: undefined }), context());
      expect(result.applicable && result.effect.subtotalDiscount.isZero()).toBe(true);
    }
  });
});
