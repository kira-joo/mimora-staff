import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { orderRepository, paymentProofRepository } from "../../core/repositories";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { assertPaymentTransition, timelineEventForPaymentStatus } from "../../engines/order-state/order-state-machine";

export interface VerifyPaymentInput {
  orderId: string;
  staffId: string;
  now: Date;
}

/**
 * Verifies a submitted payment — `Order.payment.status` SUBMITTED → VERIFIED,
 * and the matching `PaymentProof` row (submission history, not overwritten
 * on rejection — see that schema's own doc comment) moves SUBMITTED →
 * VERIFIED alongside it, both attributed to the same staff actor.
 */
export async function verifyPayment(input: VerifyPaymentInput) {
  const { orderId, staffId, now } = input;

  const order = await orderRepository.findOne({ where: { _id: orderId } });

  return withTransaction(async (tx) => {
    assertPaymentTransition(order.payment.status, "VERIFIED");

    await orderRepository.updateAtomic(
      { _id: order._id, "payment.status": order.payment.status },
      { $set: { "payment.status": "VERIFIED", "payment.verification": { verifiedBy: staffId, verifiedAt: now } } }
    );

    await paymentProofRepository.updateAtomic(
      { orderId: order._id, status: "SUBMITTED" },
      { $set: { status: "VERIFIED", reviewedBy: staffId, reviewedAt: now } },
      { skipThrowError: true }
    );

    await appendOrderTimelineEntry(order._id, {
      type: timelineEventForPaymentStatus("VERIFIED")!,
      at: now,
      actorType: "STAFF",
      actorId: new mongoose.Types.ObjectId(staffId),
    });

    const updated = await orderRepository.findOne({ where: { _id: order._id } });
    return tx.complete(updated);
  });
}
