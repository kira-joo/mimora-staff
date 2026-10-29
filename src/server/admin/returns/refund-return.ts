import type { Money } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { returnRepository } from "../../core/repositories";
import { reserveOrderRefund } from "../../commerce/order-refunds";
import { assertReturnTransition, assertRefundReference } from "../../engines/returns/return-eligibility";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";

export interface RefundReturnInput {
  returnId: string;
  refundReference: string;
  amount: Money;
  staffId: string;
  now: Date;
}

/** Per D-12: records and audits a refund; never executes one. `refundReference` is mandatory — always a human-supplied proof the money actually moved. */
export async function refundReturn(input: RefundReturnInput) {
  const { returnId, refundReference, staffId, now } = input;

  const ret = await returnRepository.findOne({ where: { _id: returnId } });
  assertReturnTransition(ret.status, "REFUNDED");
  assertRefundReference(refundReference);

  const { amount } = input;

  return withTransaction(async (tx) => {
    await reserveOrderRefund(ret.orderId, amount);
    const updated = await returnRepository.updateAtomic(
      { _id: ret._id, status: ret.status },
      { $set: { status: "REFUNDED", refundReference: refundReference.trim(), refundAmount: amount, processedAt: now, processedBy: staffId } }
    );

    await appendOrderTimelineEntry(ret.orderId, {
      type: "REFUND_ISSUED",
      at: now,
      actorType: "STAFF",
      actorId: new mongoose.Types.ObjectId(staffId),
      metadata: { returnId: ret._id.toString(), reference: refundReference.trim() },
    });

    return tx.complete(updated);
  });
}
