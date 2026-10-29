import { BadRequestError, ConflictError } from "@kira-joo/backend-toolkit-core";
import { MONEY_SCALE, type Money } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { orderRepository } from "../core/repositories";

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
 */
export async function reserveOrderRefund(orderId: mongoose.Types.ObjectId, amount: Money): Promise<void> {
  if (!amount.greaterThan(0)) {
    throw new BadRequestError("A refund amount must be greater than zero.");
  }

  const increment = mongoose.Types.Decimal128.fromString(amount.toFixed(MONEY_SCALE));
  const reserved = await orderRepository.updateAtomic(
    {
      _id: orderId,
      $expr: { $lte: [{ $add: [{ $ifNull: ["$refundedTotal", 0] }, increment] }, "$total"] },
    },
    { $inc: { refundedTotal: increment } },
    { skipThrowError: true }
  );

  if (!reserved) {
    throw new ConflictError("This refund would exceed the order's refundable amount.");
  }
}
