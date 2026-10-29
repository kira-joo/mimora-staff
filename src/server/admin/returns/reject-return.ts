import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { returnRepository } from "../../core/repositories";
import { assertReturnTransition } from "../../engines/returns/return-eligibility";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";

export interface RejectReturnInput {
  returnId: string;
  reason: string;
  staffId: string;
  now: Date;
}

/** A rejected return is a dead end by design (D-12/return-eligibility.ts's own doc comment) — a staff decision about the goods, not a retriable customer error like a rejected payment proof. */
export async function rejectReturn(input: RejectReturnInput) {
  const { returnId, reason, staffId, now } = input;
  const ret = await returnRepository.findOne({ where: { _id: returnId } });

  assertReturnTransition(ret.status, "REJECTED", reason);

  return withTransaction(async (tx) => {
    const updated = await returnRepository.updateAtomic(
      { _id: ret._id, status: ret.status },
      { $set: { status: "REJECTED", processedAt: now, processedBy: staffId, notes: reason } }
    );

    await appendOrderTimelineEntry(ret.orderId, {
      type: "RETURN_REJECTED",
      at: now,
      actorType: "STAFF",
      actorId: new mongoose.Types.ObjectId(staffId),
      reason,
    });

    return tx.complete(updated);
  });
}
