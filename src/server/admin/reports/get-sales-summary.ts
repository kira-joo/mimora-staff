import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { sanitizeLeanResult } from "@kira-joo/backend-toolkit-mongoose";
import { ZERO, type Money } from "@kira-joo/toolkit-common";
import { OrderModel } from "../../commerce/order.schema";
import { ReturnModel } from "../../commerce/return.schema";
import { storeTimeZone } from "../../core/config/store-timezone";
import {
  SalesRangeError,
  periodFormat,
  resolveSalesRange,
  summarizeSales,
  type SalesGranularity,
  type SalesSummary,
} from "../../engines/reports/sales-summary";

export interface GetSalesSummaryInput {
  granularity?: SalesGranularity;
  from?: string;
  to?: string;
  now: Date;
}

/**
 * MDS §15a sales summary: revenue, order count and average order value per
 * day or month.
 *
 * **Revenue = sales of non-cancelled orders − refunds**, each in the period
 * it happened (in `STORE_TIMEZONE`): an order on its placement date, a refund
 * on the date it was recorded, whichever period its order belongs to. Refunds
 * come from the two records the domain keeps — `Order.payment.refund.amount`
 * for a standalone payment refund, `Return.refundAmount` for a return
 * refund — and `reserveOrderRefund` guarantees each refund operation writes
 * exactly one of them and that an order's refunds never exceed its total.
 * Refunds of a cancelled order are left out, as its sales are.
 *
 * An `aggregate`, not a repository call: grouping by period has no
 * repository equivalent. `total` is summed as `Decimal128` inside the
 * database, so revenue is exact before it ever reaches JavaScript.
 */
export async function getSalesSummary(input: GetSalesSummaryInput): Promise<SalesSummary> {
  const granularity = input.granularity ?? "day";
  const timeZone = storeTimeZone();

  let range;
  try {
    range = resolveSalesRange({ granularity, from: input.from, to: input.to, now: input.now, timeZone });
  } catch (error) {
    if (error instanceof SalesRangeError) throw new BadRequestError(error.message);
    throw error;
  }

  const inRange = { $gte: range.start, $lt: range.end };
  const bucketOf = (dateField: string) => ({ $dateToString: { format: periodFormat(granularity), date: dateField, timezone: timeZone } });

  // Aggregates, not repository calls: grouping by period has no repository equivalent.
  // Sequential, matching the rest of the codebase's one-operation-at-a-time reads.
  const orders: Array<{ _id: string; orderCount: number; grossSales: Money }> = sanitizeLeanResult(
    await OrderModel.aggregate([
      { $match: { placedAt: inRange, status: { $ne: "CANCELLED" } } },
      { $group: { _id: bucketOf("$placedAt"), orderCount: { $sum: 1 }, grossSales: { $sum: "$total" } } },
    ])
  );

  // A standalone payment refund counts on the day it was recorded.
  const paymentRefunds: Array<{ _id: string; refunds: Money }> = sanitizeLeanResult(
    await OrderModel.aggregate([
      { $match: { "payment.status": "REFUNDED", "payment.refund.at": inRange, status: { $ne: "CANCELLED" } } },
      { $group: { _id: bucketOf("$payment.refund.at"), refunds: { $sum: "$payment.refund.amount" } } },
    ])
  );

  // A return refund counts on the day it was recorded — `processedAt`, which
  // `refundReturn` sets as it moves the return to REFUNDED. Joined to its order
  // only to drop refunds of cancelled orders, whose sales are not counted either.
  const returnRefunds: Array<{ _id: string; refunds: Money }> = sanitizeLeanResult(
    await ReturnModel.aggregate([
      { $match: { status: "REFUNDED", processedAt: inRange } },
      { $lookup: { from: OrderModel.collection.name, localField: "orderId", foreignField: "_id", as: "order", pipeline: [{ $project: { status: 1 } }] } },
      { $match: { "order.status": { $ne: "CANCELLED" } } },
      { $group: { _id: bucketOf("$processedAt"), refunds: { $sum: "$refundAmount" } } },
    ])
  );

  // Each refund operation wrote exactly one record (a payment refund or a
  // return refund, never both — `reserveOrderRefund`), so adding the two
  // streams counts every refunded amount exactly once.
  const refundsByPeriod = new Map<string, Money>();
  for (const bucket of [...paymentRefunds, ...returnRefunds]) {
    refundsByPeriod.set(bucket._id, (refundsByPeriod.get(bucket._id) ?? ZERO).plus(bucket.refunds));
  }

  return summarizeSales({
    granularity,
    range,
    orders: orders.map((bucket) => ({ period: bucket._id, orderCount: bucket.orderCount, grossSales: bucket.grossSales })),
    refunds: [...refundsByPeriod].map(([period, refunds]) => ({ period, refunds })),
  });
}
