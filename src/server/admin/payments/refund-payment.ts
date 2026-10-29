import type { Money } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { orderRepository } from "../../core/repositories";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { reserveOrderRefund } from "../../commerce/order-refunds";
import { assertRefundReference } from "../../engines/returns/return-eligibility";
import { assertPaymentTransition, timelineEventForPaymentStatus } from "../../engines/order-state/order-state-machine";

export interface RefundPaymentInput {
  orderId: string;
  amount: Money;
  reason?: string;
  /** Mandatory (D-12) — the human-supplied proof the money moved. */
  reference: string;
  staffId: string;
  now: Date;
}

/** Refunds a payment — VERIFIED or NOT_REQUIRED → REFUNDED, both allowed by the order-state-machine's own map. `amount` is required and must fit the order's refundable remainder; `reference` is mandatory (D-12). */
export async function refundPayment(input: RefundPaymentInput) {
  const { orderId, reason, staffId, now } = input;
  assertRefundReference(input.reference);
  const reference = input.reference.trim();

  const order = await orderRepository.findOne({ where: { _id: orderId } });
  const { amount } = input;

  return withTransaction(async (tx) => {
    assertPaymentTransition(order.payment.status, "REFUNDED");
    await reserveOrderRefund(order._id, amount);

    await orderRepository.updateAtomic(
      { _id: order._id, "payment.status": order.payment.status },
      { $set: { "payment.status": "REFUNDED", "payment.refund": { reason, by: staffId, at: now, reference, amount } } }
    );

    await appendOrderTimelineEntry(order._id, {
      type: timelineEventForPaymentStatus("REFUNDED")!,
      at: now,
      actorType: "STAFF",
      actorId: new mongoose.Types.ObjectId(staffId),
      reason,
    });

    // Two writes land in this transaction (the $set above, the timeline
    // $push inside appendOrderTimelineEntry) — the returned document must
    // reflect both.
    const updated = await orderRepository.findOne({ where: { _id: order._id } });
    return tx.complete(updated);
  });
}
