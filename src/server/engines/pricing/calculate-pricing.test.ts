import { MONEY_SCALE, ZERO, toMoney, type Money } from "@kira-joo/toolkit-common";
import { describe, expect, it } from "vitest";
import { calculatePricing } from "./calculate-pricing";
import type { PricingInput } from "./pricing.types";

/**
 * Amounts are written the way they are configured and displayed: **major
 * units**, as strings.
 *
 * Strings rather than numbers deliberately. `toMoney(10.5)` is exact — decimal
 * .js reads a number through its `toString()` — but a literal invites the next
 * person to write `toMoney(0.1 + 0.2)`, and that value is already wrong before
 * this function sees it. Strings make the arithmetic impossible to perform by
 * accident.
 */
const m = (value: string) => toMoney(value);

/**
 * Asserts an exact amount *and* its scale in one step.
 *
 * `toFixed(MONEY_SCALE)` is the assertion, not `toEqual`: comparing `Decimal`
 * instances structurally would pass for a value carrying extra decimal places
 * that happens to be equal, and a third decimal reaching a stored total is
 * precisely the defect worth catching. Formatting to the scale first means the
 * test fails on it.
 */
const expectMoney = (actual: Money | undefined, expected: string) =>
  expect(actual?.toFixed(MONEY_SCALE)).toBe(expected);

const noTax = { mode: "ADDED" as const, rate: 0 };

function input(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    lines: [{ unitBasePrice: m("10.00"), quantity: 1 }],
    tax: noTax,
    ...overrides,
  };
}

describe("line pricing", () => {
  it("prices a single line", () => {
    const result = calculatePricing(input({ lines: [{ unitBasePrice: m("10.00"), quantity: 1 }] }));

    expectMoney(result.lines[0]?.lineTotal, "10.00");
    expectMoney(result.subtotal, "10.00");
  });

  it("multiplies by quantity exactly, without compounding a rounding error", () => {
    /*
     * Rounding per unit and then multiplying compounds the error by the
     * quantity — how a 20-item order ends up several piastres off. Multiplying
     * a Decimal by an integer quantity is exact.
     */
    const result = calculatePricing(input({ lines: [{ unitBasePrice: m("3.33"), quantity: 20 }] }));

    expectMoney(result.lines[0]?.lineTotal, "66.60");
    expectMoney(result.subtotal, "66.60");
  });

  it("keeps a fractional unit price exact across a large quantity", () => {
    /*
     * The case major units introduce that minor-unit integers could not have.
     * 0.07 is not representable in binary floating point: 0.07 * 3 is
     * 0.21000000000000002 as a JS number, and at quantity 99 the drift is
     * visible in the second decimal place. Decimal multiplies the digits.
     */
    const result = calculatePricing(input({ lines: [{ unitBasePrice: m("0.07"), quantity: 99 }] }));

    expectMoney(result.lines[0]?.lineTotal, "6.93");
    expect(0.07 * 99).not.toBe(6.93); // the same computation as a float
  });

  it("sums several lines", () => {
    const result = calculatePricing(
      input({
        lines: [
          { unitBasePrice: m("10.00"), quantity: 2 },
          { unitBasePrice: m("7.50"), quantity: 3 },
        ],
      })
    );

    // 20.00 + 22.50
    expectMoney(result.subtotal, "42.50");
  });

  it("prices an empty basket as zero", () => {
    const result = calculatePricing(input({ lines: [] }));
    expectMoney(result.subtotal, "0.00");
    expectMoney(result.total, "0.00");
  });
});

describe("discount", () => {
  it("subtracts from the subtotal", () => {
    const result = calculatePricing(
      input({ discount: { subtotalDiscount: m("3.00"), waivesShippingFee: false } })
    );

    expectMoney(result.discount, "3.00");
    expectMoney(result.total, "7.00");
  });

  it("is capped at the subtotal, never producing a negative total", () => {
    /*
     * A "50 off" coupon on a 30 basket discounts 30. Without the cap the
     * subtotal goes negative and then silently pays for shipping, turning a
     * coupon into a cash withdrawal.
     */
    const result = calculatePricing(
      input({
        lines: [{ unitBasePrice: m("30.00"), quantity: 1 }],
        shippingFee: m("15.00"),
        discount: { subtotalDiscount: m("50.00"), waivesShippingFee: false },
      })
    );

    expectMoney(result.discount, "30.00");
    // Shipping is still owed.
    expectMoney(result.total, "15.00");
  });

  it("is stored positive", () => {
    // A signed value invites a sign error at every display site.
    const result = calculatePricing(
      input({ discount: { subtotalDiscount: m("3.00"), waivesShippingFee: false } })
    );
    expect(result.discount.isNegative()).toBe(false);
    expect(result.discount.isZero()).toBe(false);
  });

  it("ignores a negative discount rather than adding it to the bill", () => {
    const result = calculatePricing(
      input({ discount: { subtotalDiscount: m("-3.00"), waivesShippingFee: false } })
    );
    expectMoney(result.discount, "0.00");
    expectMoney(result.total, "10.00");
  });
});

describe("shipping fee", () => {
  it("is charged when supplied", () => {
    const result = calculatePricing(input({ shippingFee: m("15.00") }));
    expectMoney(result.shippingFee, "15.00");
    expectMoney(result.total, "25.00");
  });

  it("is zero for pickup, where none is supplied", () => {
    const result = calculatePricing(input({ shippingFee: undefined }));
    expectMoney(result.shippingFee, "0.00");
  });

  it("is waived by a free-shipping promotion", () => {
    const result = calculatePricing(
      input({
        shippingFee: m("15.00"),
        discount: { subtotalDiscount: ZERO, waivesShippingFee: true },
      })
    );

    expectMoney(result.shippingFee, "0.00");
    expectMoney(result.discount, "0.00");
    expectMoney(result.total, "10.00");
  });

  it("waiving shipping on a pickup order changes nothing", () => {
    const result = calculatePricing(input({ discount: { subtotalDiscount: ZERO, waivesShippingFee: true } }));
    expectMoney(result.total, "10.00");
  });
});

describe("tax", () => {
  it("adds tax on top in ADDED mode", () => {
    // 14% of 10.00 is 1.40.
    const result = calculatePricing(input({ tax: { mode: "ADDED", rate: 14 } }));
    expectMoney(result.tax, "1.40");
    expectMoney(result.total, "11.40");
  });

  it("extracts tax BACKWARDS out of the total in INCLUDED mode", () => {
    /*
     * The error worth guarding against. The price already contains the tax, so
     * the component is `gross − gross / (1 + rate)`, not `gross × rate`.
     *
     * On 11.40 at 14%: net is 10.00, tax is 1.40. Computing 11.40 × 0.14 would
     * give 1.60 — overstating by 14% of itself, in a number only an accountant
     * checks.
     */
    const result = calculatePricing(
      input({
        lines: [{ unitBasePrice: m("11.40"), quantity: 1 }],
        tax: { mode: "INCLUDED", rate: 14 },
      })
    );

    expectMoney(result.tax, "1.40");
    // The customer pays the displayed price — tax is informational.
    expectMoney(result.total, "11.40");
  });

  it("divides rather than multiplying by a float reciprocal in INCLUDED mode", () => {
    /*
     * The naive INCLUDED implementation computes `base × (1 / divisor)`, and
     * that reciprocal is a float.
     *
     * Whether it matters is rate-dependent, which is why it goes unnoticed in
     * a smaller sweep. Scanning every amount from 0.01 to 20,000.00: at 5%,
     * 7.25%, 8.5%, 14% and 15% the two routes never disagree once rounded to
     * the money scale. At 20%, a rate a great many jurisdictions use, they
     * disagree 248,737 times, starting at 0.03.
     *
     * 1/1.2 is 0.8333…, and the values that break are the ones whose exact tax
     * lands on the half-up boundary: at 90.03 the true component is 15.005,
     * which rounds to 15.01, while the float route computes 15.00499…9 and
     * rounds down. A piastre, on a number an accountant reconciles.
     */
    const base = "90.03";
    const result = calculatePricing(
      input({
        lines: [{ unitBasePrice: m(base), quantity: 1 }],
        tax: { mode: "INCLUDED", rate: 20 },
      })
    );

    expectMoney(result.tax, "15.01");

    // The route this guards against, for contrast — it rounds the other way.
    const viaReciprocal = Number(base) - Number(base) * (1 / 1.2);
    expect(viaReciprocal.toFixed(MONEY_SCALE)).toBe("15.00");
  });

  it("applies tax to shipping too", () => {
    const result = calculatePricing(
      input({
        shippingFee: m("5.00"),
        tax: { mode: "ADDED", rate: 10 },
      })
    );

    // 10% of (10.00 + 5.00).
    expectMoney(result.tax, "1.50");
    expectMoney(result.total, "16.50");
  });

  it("is zero at a zero rate under either mode", () => {
    expectMoney(calculatePricing(input({ tax: { mode: "ADDED", rate: 0 } })).tax, "0.00");
    expectMoney(calculatePricing(input({ tax: { mode: "INCLUDED", rate: 0 } })).tax, "0.00");
  });

  it("rounds a fractional tax to the money scale", () => {
    // 14% of 15.55 is 2.177, which rounds half-up to 2.18.
    const result = calculatePricing(
      input({
        lines: [{ unitBasePrice: m("15.55"), quantity: 1 }],
        tax: { mode: "ADDED", rate: 14 },
      })
    );

    expect(result.tax.decimalPlaces()).toBeLessThanOrEqual(MONEY_SCALE);
    expectMoney(result.tax, "2.18");
  });
});

describe("the full breakdown", () => {
  it("composes every component in the documented order", () => {
    const result = calculatePricing({
      lines: [
        { unitBasePrice: m("55.00"), quantity: 2 },
        { unitBasePrice: m("20.00"), quantity: 1 },
      ],
      shippingFee: m("15.00"),
      tax: { mode: "ADDED", rate: 14 },
      discount: { subtotalDiscount: m("10.00"), waivesShippingFee: false },
    });

    //  lines:     55.00 × 2 = 110.00, plus 20.00             → subtotal 130.00
    //  discount:  10.00                                       → discounted 120.00
    //  taxable:   120.00 + 15.00                              → 135.00
    //  tax:       14% of 135.00                               → 18.90
    //  total:     135.00 + 18.90                              → 153.90
    expectMoney(result.subtotal, "130.00");
    expectMoney(result.discount, "10.00");
    expectMoney(result.shippingFee, "15.00");
    expectMoney(result.tax, "18.90");
    expectMoney(result.total, "153.90");
  });

  it("returns every component already at the money scale", () => {
    const result = calculatePricing(
      input({
        lines: [{ unitBasePrice: m("9.99"), quantity: 7 }],
        shippingFee: m("5.00"),
        tax: { mode: "ADDED", rate: 8.5 },
        discount: { subtotalDiscount: m("1.11"), waivesShippingFee: false },
      })
    );

    for (const [name, value] of Object.entries({
      subtotal: result.subtotal,
      discount: result.discount,
      shippingFee: result.shippingFee,
      tax: result.tax,
      total: result.total,
    })) {
      expect(`${name}:${value.decimalPlaces() <= MONEY_SCALE}`).toBe(`${name}:true`);
    }
  });

  it("returns a total that is exactly the sum of the parts beside it", () => {
    /*
     * A customer can add up the breakdown they were shown. If rounding
     * happened once at the end instead of as each component was produced,
     * this would be off by a piastre — arithmetically defensible and
     * indistinguishable from a mistake.
     */
    const result = calculatePricing(
      input({
        lines: [{ unitBasePrice: m("9.99"), quantity: 7 }],
        shippingFee: m("5.00"),
        tax: { mode: "ADDED", rate: 8.5 },
        discount: { subtotalDiscount: m("1.11"), waivesShippingFee: false },
      })
    );

    const composed = result.subtotal.minus(result.discount).plus(result.shippingFee).plus(result.tax);

    expectMoney(result.total, composed.toFixed(MONEY_SCALE));
  });

  it("never returns a negative total", () => {
    const result = calculatePricing(
      input({ discount: { subtotalDiscount: m("9999.99"), waivesShippingFee: true } })
    );
    expect(result.total.isNegative()).toBe(false);
  });
});
