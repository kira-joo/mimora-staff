import { SortOrder } from "@kira-joo/toolkit-common";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";
import { orderRepository, returnRepository } from "../../core/repositories";
import { ReturnLineModel } from "../../commerce/return.schema";
import { customerReturnStatus } from "../../engines/returns/return-eligibility";
import type { ReturnListItemView } from "./returns.types";

export interface ListReturnsInput {
  customer: CustomerIdentity;
  limit?: number;
  offset?: number;
}

/**
 * Lists the customer's own returns for `GET /api/shop/returns`, most
 * recent first. Never another customer's returns — scoped by `customerId`
 * at the query, the same ownership pattern as `listOrders`.
 */
export async function listReturns(input: ListReturnsInput): Promise<ReturnListItemView[]> {
  const { customer, limit = 20, offset = 0 } = input;

  const returns = await returnRepository.findAll({
    where: { customerId: customer._id },
    sort: { field: "requestedAt", order: SortOrder.DESC },
    skip: offset,
    take: limit,
  });

  const returnIds = returns.map((r) => r._id);
  const orderIds = [...new Set(returns.map((r) => r.orderId.toString()))];

  const [lineCounts, orders] = await Promise.all([
    // Direct Model use: `$group` line counts are not expressible through the repository.
    ReturnLineModel.aggregate([
      { $match: { returnId: { $in: returnIds } } },
      { $group: { _id: "$returnId", count: { $sum: 1 } } },
    ]),
    orderRepository.findByIds(orderIds, { select: { orderNumber: true } }),
  ]);

  const lineCountMap = new Map(lineCounts.map((item) => [item._id.toString(), item.count]));
  const orderNumberById = new Map(orders.map((order) => [order._id.toString(), order.orderNumber]));

  return returns.map((ret) => ({
    returnId: ret._id.toString(),
    returnNumber: ret.returnNumber,
    orderNumber: orderNumberById.get(ret.orderId.toString()) ?? "",
    status: customerReturnStatus(ret.status),
    reason: ret.reason,
    requestedAt: ret.requestedAt,
    lineCount: lineCountMap.get(ret._id.toString()) ?? 0,
  }));
}
