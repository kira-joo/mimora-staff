import { SortOrder, type Money } from "@kira-joo/toolkit-common";
import { toEvaluablePromotion } from "../../commerce/promotion-evaluable";
import type { PromotionSchema } from "../../commerce/promotion.schema";
import { promotionRepository } from "../../core/repositories";
import { evaluatePromotion, selectBestPromotion } from "../../engines/promotions/evaluate-promotion";
import type { PromotionContext, PromotionEvaluation } from "../../engines/promotions/evaluate-promotion.types";
import { loadCustomerPromotionHistory } from "./derive-promotion-context";

type Promotion = PromotionSchema & { _id: { toString(): string } };

export interface ResolvedPromotion {
  promotion: Promotion;
  evaluation: PromotionEvaluation & { applicable: true };
  /** True for a promotion with no code — applied without the customer entering anything. */
  automatic: boolean;
}

/**
 * THE promotion an order gets — one function, called by the cart quote and by
 * order placement, so the price a customer is shown is the price they are
 * charged (a second copy of this choice in either place is how the two drift).
 *
 * Candidates: the code on the cart (if any) and every ACTIVE automatic
 * promotion (no code). Each is judged by the one rules engine
 * (`evaluatePromotion`) and the best for the customer wins
 * (`selectBestPromotion` — at most one promotion per order in v1, free
 * shipping valued at the fee it waives). On a tie the entered code wins, then
 * the older automatic promotion, so the choice is deterministic.
 *
 * Usage history is read through the ambient session: inside placement it is
 * the same snapshot that records the use, which is what makes limits hold
 * under concurrency (see place-order.ts).
 *
 * **Per-customer limits** — coded or automatic — are counted by promotion id
 * from each order's `appliedPromotion` snapshot (legacy orders by their line
 * code); see `loadCustomerPromotionHistory`.
 */
export async function resolveOrderPromotion(input: {
  code?: string;
  customerId?: string;
  now: Date;
  subtotal: Money;
  lines: PromotionContext["lines"];
  /** The resolved shipping fee, or undefined while shipping is pending — the same value the caller prices with. */
  shippingFee?: Money;
}): Promise<ResolvedPromotion | undefined> {
  const coded = input.code
    ? await promotionRepository.findOne({ where: { code: input.code.toUpperCase() }, skipThrowError: true })
    : null;
  const automatic = await promotionRepository.findAll({
    where: { active: true, $or: [{ code: { $exists: false } }, { code: null }, { code: "" }] },
    sort: { field: "_id", order: SortOrder.ASC }, // oldest first: the deterministic tie-break
  });
  const candidates = [...(coded ? [coded] : []), ...automatic] as Promotion[];
  if (candidates.length === 0) return undefined;

  const history = input.customerId ? await loadCustomerPromotionHistory(input.customerId) : undefined;

  const evaluations = [];
  for (const promotion of candidates) {
    // Uses are only counted where a limit makes them matter. A guest's cannot be counted at all
    // (derivePromotionContextForActor), so a per-customer limit is treated as used up for them.
    const limited = promotion.limits?.perCustomerUses != null;
    const customerUses = !limited ? 0 : !history ? Number.POSITIVE_INFINITY : await history.usesOf({ id: promotion._id.toString(), code: promotion.code });
    evaluations.push({
      promotionId: promotion._id.toString(),
      evaluation: evaluatePromotion(toEvaluablePromotion(promotion), {
        now: input.now,
        subtotal: input.subtotal,
        lines: input.lines,
        isFirstOrder: history?.isFirstOrder ?? false,
        customerUses,
      }),
    });
  }

  const best = selectBestPromotion(evaluations, input.shippingFee);
  if (!best) return undefined;
  const promotion = candidates.find((candidate) => candidate._id.toString() === best.promotionId)!;
  return { promotion, evaluation: best.evaluation, automatic: !promotion.code };
}
