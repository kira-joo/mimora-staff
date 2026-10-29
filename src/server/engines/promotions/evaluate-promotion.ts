import { ZERO, roundMoney, sum, toMoney, type Money } from "@kira-joo/toolkit-common";
import type { AppliedDiscount } from "../pricing/pricing.types";
import type { EvaluablePromotion, PromotionContext, PromotionEvaluation, PromotionRejection } from "./evaluate-promotion.types";

/**
 * Whether a promotion applies, and what it is worth.
 *
 * Pure and separate from pricing on purpose: eligibility is a rules problem and
 * arithmetic is a numbers problem, and a module that does both is harder to
 * test than two that each do one. Pricing takes the *effect* this produces.
 *
 * **A rejection always names its cause.** A promotion that silently fails to
 * apply is the most expensive and most common promotion bug — the customer
 * believes they got a discount, the operator believes the campaign is
 * running, and nothing anywhere says otherwise.
 *
 * There is no fulfilment-mode condition here, unlike the restaurant precedent
 * this engine was first ported from — `PromotionSchema.conditions` has no
 * such field (MDS §8.2), so it was invented scope, not a real one.
 */
export function evaluatePromotion(promotion: EvaluablePromotion, context: PromotionContext): PromotionEvaluation {
  const { conditions, limits } = promotion;

  if (!promotion.active) return reject("INACTIVE");

  if (conditions.startsAt && context.now < conditions.startsAt) return reject("NOT_STARTED");
  if (conditions.endsAt && context.now > conditions.endsAt) return reject("EXPIRED");

  // `!= null`, not `!== undefined`: a limit that reaches the engine as null means "no limit", never "zero uses left".
  if (limits.totalUses != null && promotion.usageCount >= limits.totalUses) {
    return reject("USAGE_LIMIT_REACHED");
  }

  if (limits.perCustomerUses != null && context.customerUses >= limits.perCustomerUses) {
    return reject("CUSTOMER_LIMIT_REACHED");
  }

  if (conditions.firstOrderOnly && !context.isFirstOrder) return reject("NOT_FIRST_ORDER");

  /*
   * The minimum is checked against the WHOLE subtotal, while the discount is
   * computed on the eligible portion. "Spend 200, get 20% off accessories" is
   * the natural reading, and requiring 200 of accessories alone would make
   * most category promotions unreachable.
   */
  if (conditions.minSubtotal && context.subtotal.lessThan(conditions.minSubtotal)) {
    return reject("BELOW_MINIMUM");
  }

  const eligibleSubtotal = resolveEligibleSubtotal(promotion, context);

  if (promotion.type !== "FREE_SHIPPING" && eligibleSubtotal.lessThanOrEqualTo(ZERO)) {
    return reject("NO_ELIGIBLE_ITEMS");
  }

  return {
    applicable: true,
    eligibleSubtotal,
    effect: resolveEffect(promotion, eligibleSubtotal),
  };
}

function reject(rejection: PromotionRejection): PromotionEvaluation {
  return { applicable: false, rejection };
}

/**
 * The portion of the basket a promotion applies to.
 *
 * With every scoping array empty this is the whole subtotal. With any set, a
 * line is eligible if it matches ANY of them — category, collection, product,
 * or variant — mirroring `PromotionSchema.conditions` exactly (MDS §8.2 lists
 * all four as siblings, not a single field).
 */
function resolveEligibleSubtotal(promotion: EvaluablePromotion, context: PromotionContext): Money {
  const { categories, collections, products, variants } = promotion.conditions;

  if (categories.length === 0 && collections.length === 0 && products.length === 0 && variants.length === 0) {
    return context.subtotal;
  }

  const eligible = context.lines.filter(
    (line) =>
      categories.includes(line.categoryId) ||
      line.collectionIds.some((id) => collections.includes(id)) ||
      products.includes(line.productId) ||
      variants.includes(line.variantId)
  );

  return sum(eligible.map((line) => line.lineTotal));
}

function resolveEffect(promotion: EvaluablePromotion, eligibleSubtotal: Money): AppliedDiscount {
  switch (promotion.type) {
    case "FREE_SHIPPING":
      // Affects the shipping fee, not the subtotal. Pricing waives the fee;
      // the discount line stays zero so the breakdown reads honestly.
      return { subtotalDiscount: ZERO, waivesShippingFee: true };

    case "PERCENT":
      return {
        subtotalDiscount: roundMoney(eligibleSubtotal.mul(clampPercent(promotion.value ?? ZERO)).div(100)),
        waivesShippingFee: false,
      };

    case "FIXED":
      // Capped at the eligible subtotal — a category-restricted promotion
      // must not spill onto items it was never meant to discount.
      return {
        subtotalDiscount: capFixed(roundMoney(promotion.value ?? ZERO), eligibleSubtotal),
        waivesShippingFee: false,
      };
  }
}

/** Clamped into `[0, eligibleSubtotal]` — a negative coupon must not become a charge. */
function capFixed(requested: Money, eligibleSubtotal: Money): Money {
  if (requested.isNegative()) return ZERO;
  return requested.greaterThan(eligibleSubtotal) ? eligibleSubtotal : requested;
}

const HUNDRED = toMoney(100);

/** A percentage outside 0–100 is a data-entry error; clamping is safer than trusting it. Decimal throughout — no float. */
function clampPercent(value: Money): Money {
  if (!value.isFinite() || value.isNegative()) return ZERO;
  return value.greaterThan(HUNDRED) ? HUNDRED : value;
}

/**
 * Picks the promotion worth most to the customer, among those NOT marked
 * `stackable`. `PromotionSchema.stackable` exists on the model but combining
 * two active discounts is out of scope here — the rule surface it opens
 * (order of application, interacting caps) is a real feature, not a small
 * extension, so v1 always resolves to at most one applied promotion and
 * `stackable` is reserved for when that changes.
 *
 * A free-shipping promotion is compared on the shipping fee it would waive,
 * so it can genuinely win against a small percentage discount.
 */
export function selectBestPromotion(
  evaluations: { promotionId: string; evaluation: PromotionEvaluation }[],
  shippingFee: Money | undefined
): { promotionId: string; evaluation: PromotionEvaluation & { applicable: true } } | undefined {
  const applicable = evaluations.filter(
    (entry): entry is { promotionId: string; evaluation: PromotionEvaluation & { applicable: true } } =>
      entry.evaluation.applicable
  );

  if (applicable.length === 0) return undefined;

  return applicable.reduce((best, candidate) =>
    valueOf(candidate.evaluation.effect, shippingFee).greaterThan(valueOf(best.evaluation.effect, shippingFee))
      ? candidate
      : best
  );
}

/**
 * What a promotion is worth to the customer, as `Money`.
 *
 * The comparison in `selectBestPromotion` is `greaterThan`, never `>`. A
 * `Decimal`'s `>` operator coerces both sides through `valueOf`, which for
 * decimal.js yields a float and so reintroduces exactly the imprecision the
 * type exists to avoid — silently, since the comparison still returns a
 * boolean and is right for almost every input.
 */
function valueOf(effect: AppliedDiscount, shippingFee: Money | undefined): Money {
  const waived = effect.waivesShippingFee ? (shippingFee ?? ZERO) : ZERO;
  return effect.subtotalDiscount.plus(waived);
}
