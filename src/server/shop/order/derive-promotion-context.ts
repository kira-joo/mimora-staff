import { resolveSession } from "@kira-joo/backend-toolkit-mongoose";
import { OrderLineModel, OrderModel } from "../../commerce/order.schema";
import type { ShopActor } from "../shop-actor";

/** One customer's non-cancelled orders, read once, for every promotion a placement weighs. */
export interface CustomerPromotionHistory {
  isFirstOrder: boolean;
  /** How many of those orders used this promotion. */
  usesOf(promotion: { id: string; code?: string }): Promise<number>;
}

/**
 * The customer's promotion history, read through the ambient session: inside
 * order placement this is the same transaction that records the new use — the
 * only place a limit can hold (every applied redemption writes the promotion
 * document, so two concurrent redemptions conflict and the loser re-counts
 * after the winner commits; see place-order.ts).
 *
 * A use is counted BY PROMOTION ID from the order's `appliedPromotion`
 * snapshot (2026-10-22), so renaming or removing a code cannot reset a limit
 * and automatic promotions are countable. Orders placed before the snapshot
 * existed are counted the way they always were — by the code on their lines
 * (`OrderLineSchema.promotionCode`) — and only those orders, so nothing is
 * counted twice. A cancelled order gives its use back.
 */
export async function loadCustomerPromotionHistory(customerId: string): Promise<CustomerPromotionHistory> {
  const session = resolveSession();
  const orders = await OrderModel.find(
    { customerId, status: { $ne: "CANCELLED" } },
    { _id: 1, "appliedPromotion.promotionId": 1 },
    { session }
  ).lean();
  const legacyOrderIds = orders.filter((order) => !order.appliedPromotion).map((order) => order._id);

  return {
    isFirstOrder: orders.length === 0,
    async usesOf(promotion) {
      const byId = orders.filter((order) => order.appliedPromotion?.promotionId?.toString() === promotion.id).length;
      if (!promotion.code || legacyOrderIds.length === 0) return byId;
      const legacy = await OrderLineModel.distinct(
        "orderId",
        { orderId: { $in: legacyOrderIds }, promotionCode: promotion.code.toUpperCase() },
        { session }
      );
      return byId + legacy.length;
    },
  };
}

/** `isFirstOrder` and the uses of one promotion — the single-promotion view of the history above. */
export async function derivePromotionContext(
  customerId: string,
  promotion?: { id: string; code?: string }
): Promise<{ isFirstOrder: boolean; customerUses: number }> {
  const history = await loadCustomerPromotionHistory(customerId);
  return { isFirstOrder: history.isFirstOrder, customerUses: promotion ? await history.usesOf(promotion) : 0 };
}

/**
 * The one entry point quote AND placement use, so the price a customer is
 * shown is the price placement charges. A customer's context comes from their
 * order history; a guest's is deliberately conservative: `isFirstOrder: false`
 * (a first-order promotion must not be claimable anonymously — D-9, we never
 * look up whether a guest's phone belongs to an account) and, for the same
 * reason, `customerUses: Infinity` — a guest's uses cannot be counted, so a
 * promotion with a per-customer limit is never claimable anonymously either,
 * or checking out as a guest would bypass the limit every time.
 */
export async function derivePromotionContextForActor(
  actor: ShopActor,
  promotion?: { id: string; code?: string }
): Promise<{ isFirstOrder: boolean; customerUses: number }> {
  if (actor.kind === "guest") return { isFirstOrder: false, customerUses: Number.POSITIVE_INFINITY };
  return derivePromotionContext(actor.customer._id, promotion);
}
