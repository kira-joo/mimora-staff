import { toMoney } from "@kira-joo/toolkit-common";
import type { EvaluablePromotion } from "../engines/promotions/evaluate-promotion.types";
import type { PromotionSchema } from "./promotion.schema";

/**
 * A stored promotion as the pure engine reads it — the one mapping the quote
 * and order placement share, so the two can never evaluate one promotion
 * differently.
 *
 * `value` is revived with `toMoney`: it is an exact decimal at rest, but a
 * promotion saved before it was (a plain Number) is converted once, here, at
 * the boundary — never used as a float. A limit stored as `null` (the API's
 * "no limit") is dropped, so the engine sees only real limits.
 */
export function toEvaluablePromotion(promotion: PromotionSchema): EvaluablePromotion {
  const limits = promotion.limits ?? {};
  return {
    type: promotion.type,
    value: promotion.value === undefined || promotion.value === null ? undefined : toMoney(promotion.value),
    active: promotion.active,
    conditions: {
      minSubtotal: promotion.conditions.minSubtotal ?? undefined,
      categories: promotion.conditions.categories.map(String),
      collections: promotion.conditions.collections.map(String),
      products: promotion.conditions.products.map(String),
      variants: promotion.conditions.variants.map(String),
      firstOrderOnly: promotion.conditions.firstOrderOnly,
      startsAt: promotion.conditions.startsAt ?? undefined,
      endsAt: promotion.conditions.endsAt ?? undefined,
    },
    limits: {
      totalUses: limits.totalUses ?? undefined,
      perCustomerUses: limits.perCustomerUses ?? undefined,
    },
    usageCount: promotion.usageCount,
    stackable: promotion.stackable,
  };
}
