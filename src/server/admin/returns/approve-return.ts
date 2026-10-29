import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { returnRepository } from "../../core/repositories";
import { assertReturnTransition } from "../../engines/returns/return-eligibility";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";

export interface ApproveReturnInput {
  returnId: string;
  staffId: string;
  now: Date;
}

export async function approveReturn(input: ApproveReturnInput) {
  const { returnId, staffId, now } = input;
  const ret = await returnRepository.findOne({ where: { _id: returnId } });

  assertReturnTransition(ret.status, "APPROVED");

  return withTransaction(async (tx) => {
    const updated = await returnRepository.updateAtomic(
      { _id: ret._id, status: ret.status },
      { $set: { status: "APPROVED", processedAt: now, processedBy: staffId } }
    );

    await appendOrderTimelineEntry(ret.orderId, {
      type: "RETURN_APPROVED",
      at: now,
      actorType: "STAFF",
      actorId: new mongoose.Types.ObjectId(staffId),
    });

    return tx.complete(updated);
  });
}
