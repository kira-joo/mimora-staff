import type { Promotion } from "src/api/promotions.endpoints";

export type PromotionStatus = "active" | "scheduled" | "expired" | "exhausted" | "disabled";

type StatusInput = Pick<Promotion, "active" | "usageCount" | "limits"> & { conditions: Pick<Promotion["conditions"], "startsAt" | "endsAt"> };

/**
 * What a customer would meet right now, derived only from fields the API returns.
 * The checks run in the same order as the backend engine (`evaluatePromotion`: active,
 * not started, expired, usage limit), so the list never says "Active" for a promotion
 * the engine would reject for one of these reasons. Eligibility that depends on a cart
 * (minimum, scope, first order, per-customer limit) is not a status.
 */
export function promotionStatus(promotion: StatusInput, now: Date): PromotionStatus {
  if (!promotion.active) return "disabled";
  const { startsAt, endsAt } = promotion.conditions;
  if (startsAt && now < new Date(startsAt)) return "scheduled";
  if (endsAt && now > new Date(endsAt)) return "expired";
  const totalUses = promotion.limits?.totalUses;
  if (totalUses !== undefined && totalUses !== null && promotion.usageCount >= totalUses) return "exhausted";
  return "active";
}
