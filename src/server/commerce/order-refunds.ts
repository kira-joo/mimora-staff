import { BadRequestError, ConflictError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, trackWrite } from "@kira-joo/backend-toolkit-mongoose";
import { MONEY_SCALE, type Money } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { OrderModel } from "./order.schema";

/**
 * Claims `amount` of an order's refundable total for one refund operation.
 *
 * Both refund flows — a standalone payment refund (`Order.payment.refund`)
 * and a return refund (`Return.refundAmount`) — call this inside the same
 * transaction that writes their own record, so a refund is recorded exactly
 * when, and only when, its amount fits. One conditional write on the order:
 * it matches only while `refundedTotal + amount <= total`, so neither a single
 * refund nor the sum of every refund on the order can exceed what was paid,
 * and two concurrent refunds conflict on this one document instead of both
 * passing a check they each read before the other wrote.
 *
 * ## Exact arithmetic over either storage type
 *
 * Money is stored as BSON Double (older records: Decimal128). Adding doubles in
 * the database is not exact — 0.10 + 0.20 is 0.30000000000000004, which would
 * refuse a legitimate full refund of a 0.30 order and leave a float tail in
 * `refundedTotal`. So both the guard and the new running total are computed in
 * decimal (`$toDecimal` reads a double through its shortest decimal form, and a
 * Decimal128 as stored), and the total is written back rounded, as a Double. It
 * stays one atomic conditional write — a pipeline update — so the concurrency
 * guarantee above is unchanged.
 */
export async function reserveOrderRefund(orderId: mongoose.Types.ObjectId, amount: Money): Promise<void> {
  if (!amount.greaterThan(0)) {
    throw new BadRequestError("A refund amount must be greater than zero.");
  }

  const increment = mongoose.Types.Decimal128.fromString(amount.toFixed(MONEY_SCALE));
  const refundedAfter = { $add: [{ $toDecimal: { $ifNull: ["$refundedTotal", 0] } }, increment] };
  // A pipeline update has no repository equivalent; it runs in the ambient transaction and is tracked as a write
  // exactly as `orderRepository.updateAtomic` would be.
  const reserved = await trackWrite(() =>
    OrderModel.findOneAndUpdate(
      { _id: orderId, $expr: { $lte: [refundedAfter, { $toDecimal: "$total" }] } },
      [{ $set: { refundedTotal: { $toDouble: { $round: [refundedAfter, MONEY_SCALE] } } } }],
      { updatePipeline: true, returnDocument: "after", session: resolveSession(undefined) }
    ).exec()
  );

  if (!reserved) {
    throw new ConflictError("This refund would exceed the order's refundable amount.");
  }
}
