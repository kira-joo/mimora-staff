import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { orderRepository, paymentProofRepository } from "../../core/repositories";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { assertPaymentTransition, timelineEventForPaymentStatus } from "../../engines/order-state/order-state-machine";

export interface RejectPaymentInput {
  orderId: string;
  reason: string;
  staffId: string;
  now: Date;
}

/**
 * Rejects a submitted payment — `Order.payment.status` SUBMITTED → REJECTED
 * (never a dead end: `order-state-machine.ts`'s own map lets a rejected
 * payment move back to AWAITING_PAYMENT/SUBMITTED once the customer
 * resubmits). The matching `PaymentProof` row is marked REJECTED with the
 * reason, kept as its own row rather than overwritten — the next submission
 * creates a new row.
 */
export async function rejectPayment(input: RejectPaymentInput) {
  const { orderId, reason, staffId, now } = input;

  const order = await orderRepository.findOne({ where: { _id: orderId } });

  return withTransaction(async (tx) => {
    assertPaymentTransition(order.payment.status, "REJECTED", reason);

    await orderRepository.updateAtomic(
      { _id: order._id, "payment.status": order.payment.status },
      { $set: { "payment.status": "REJECTED", "payment.verification": { verifiedBy: staffId, verifiedAt: now, rejectionReason: reason } } }
    );

    await paymentProofRepository.updateAtomic(
      { orderId: order._id, status: "SUBMITTED" },
      { $set: { status: "REJECTED", reviewedBy: staffId, reviewedAt: now, rejectionReason: reason } },
      { skipThrowError: true }
    );

    await appendOrderTimelineEntry(order._id, {
      type: timelineEventForPaymentStatus("REJECTED")!,
      at: now,
      actorType: "STAFF",
      actorId: new mongoose.Types.ObjectId(staffId),
      reason,
    });

    const updated = await orderRepository.findOne({ where: { _id: order._id } });
    return tx.complete(updated);
  });
}
