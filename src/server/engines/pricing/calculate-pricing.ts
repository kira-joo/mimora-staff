import { ZERO, roundMoney, sum, toMoney, type Money } from "@kira-joo/toolkit-common";
import type { PricedLine, PricingInput, PricingResult } from "./pricing.types";

/**
 * The single source of truth for what an order costs.
 *
 * Pure: no database, no clock, no configuration lookup. Everything it needs is
 * passed in, which is what makes it exhaustively testable — and this is the
 * one module in the system where a subtle error is a financial error rather
 * than a cosmetic one.
 *
 * **The storefront never runs this.** It sends variant ids and quantities; the
 * server prices the order and returns the answer. A client-computed total that
 * disagrees with the server is a dispute at best.
 *
 * ## Order of operations
 *
 * ```
 *   subtotal      = Σ unitBasePrice × quantity
 *   discount      = min(promotion discount, subtotal)      ← never exceeds the goods
 *   discounted    = subtotal − discount
 *   shippingFee   = 0 for pickup, or waived by a free-shipping promotion
 *   tax           = per mode, on (discounted + shippingFee)
 *   total         = discounted + shippingFee + (tax if ADDED)
 * ```
 *
 * **The discount is capped at the subtotal.** A fixed-amount promotion larger
 * than the basket must not produce a negative subtotal, and must not silently
 * pay for shipping either — a "50 off" coupon on a 30 basket discounts 30.
 *
 * A variant owns its price absolutely (Phase 2 non-negotiable #2) — there is
 * no modifier/option-delta layer here, unlike the restaurant precedent this
 * engine was first ported from. `unitBasePrice` is the whole price.
 *
 * ## Where rounding happens
 *
 * Every input is already at scale, and the only operation that can leave it is
 * tax. It rounds the moment it produces an amount, so every component of the
 * result is at scale and `total` is exactly the sum of the parts shown beside
 * it. Composing first and rounding the total last would produce a total that
 * does not equal the breakdown a customer can add up themselves — the kind of
 * discrepancy that reads as a mistake even when the arithmetic is defensible.
 */
export function calculatePricing(input: PricingInput): PricingResult {
  const { lines, tax, discount } = input;

  const pricedLines: PricedLine[] = lines.map((line) => ({
    unitBasePrice: line.unitBasePrice,
    quantity: line.quantity,
    /*
     * Multiply by an integer quantity — exact, no rounding. Rounding per unit
     * and then multiplying would compound the error by the quantity, which is
     * how a 20-item order ends up several piastres off.
     */
    lineTotal: line.unitBasePrice.mul(line.quantity),
  }));

  const subtotal = sum(pricedLines.map((line) => line.lineTotal));

  const appliedDiscount = capDiscount(discount?.subtotalDiscount ?? ZERO, subtotal);
  const discountedSubtotal = subtotal.minus(appliedDiscount);

  const shippingFee = resolveShippingFee(input.shippingFee, discount?.waivesShippingFee ?? false);

  const taxableBase = discountedSubtotal.plus(shippingFee);
  const taxAmount = calculateTax(tax, taxableBase);

  const total = tax.mode === "ADDED" ? taxableBase.plus(taxAmount) : taxableBase;

  return {
    lines: pricedLines,
    subtotal,
    discount: appliedDiscount,
    shippingFee,
    tax: taxAmount,
    total,
  };
}

/**
 * A discount never exceeds what is being discounted.
 *
 * Without this a fixed-amount promotion larger than the basket produces a
 * negative subtotal, which then silently pays for shipping — turning a coupon
 * into a cash withdrawal.
 */
function capDiscount(requested: Money, subtotal: Money): Money {
  if (requested.lessThanOrEqualTo(ZERO)) return ZERO;
  return requested.greaterThan(subtotal) ? subtotal : requested;
}

function resolveShippingFee(fee: Money | undefined, waived: boolean): Money {
  // Absent for pickup — there is nothing to waive and nothing to charge.
  if (!fee) return ZERO;
  return waived ? ZERO : fee;
}

/**
 * Tax, per `StoreProfile.tax.mode`.
 *
 * `ADDED` is straightforward: a percentage on top. `INCLUDED` is the one worth
 * reading twice — the price already contains the tax, so the tax component is
 * extracted *backwards* out of the gross amount rather than added to it:
 *
 * ```
 *   gross = net × (1 + rate)        so        tax = gross − gross / (1 + rate)
 * ```
 *
 * Computing `gross × rate` instead is the classic error. At 14% it overstates
 * the tax by about 14% of itself, and because the number is only informational
 * nobody notices until an accountant does.
 *
 * ## Divide, never multiply by a reciprocal
 *
 * The INCLUDED branch computes `base.div(divisor)`, never `base.mul(1 /
 * divisor)` — the reciprocal is a float. Whether that is visible depends on
 * the rate: scanning every amount from 0.01 to 20,000.00, the two routes never
 * disagree at 5%, 7.25%, 8.5%, 14% or 15% once rounded to scale, but at 20% —
 * a rate a great many jurisdictions use — they disagree 248,737 times, from
 * 0.03 upwards, because 1/1.2 is 0.8333… and the error lands on the half-up
 * rounding boundary. The reciprocal route is a latent defect until someone
 * configures a rate whose reciprocal repeats badly; dividing at `Decimal`'s
 * precision has no such rate-dependent failure mode.
 *
 * The same reasoning applies to the rate itself: `.mul(rate).div(100)` rather
 * than `.mul(rate / 100)`, which would compute the ratio in float before
 * `Decimal` ever saw it.
 */
function calculateTax(settings: PricingInput["tax"], base: Money): Money {
  if (settings.rate <= 0) return ZERO;

  if (settings.mode === "ADDED") {
    return roundMoney(base.mul(settings.rate).div(100));
  }

  const divisor = toMoney(settings.rate).div(100).plus(1);
  return roundMoney(base.minus(base.div(divisor)));
}
