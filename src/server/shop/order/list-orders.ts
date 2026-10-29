import { SortOrder } from "@kira-joo/toolkit-common";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";
import { orderRepository } from "../../core/repositories";
import { OrderLineModel } from "../../commerce/order.schema";
import type { OrderListItemView } from "./order.types";

export interface ListOrdersInput {
  customer: CustomerIdentity;
  limit?: number;
  offset?: number;
}

/**
 * Lists the customer's order history for `GET /api/shop/orders`.
 *
 * Returns orders most recent first, with minimal fields for browsing.
 * `itemCount` is derived from OrderLine count per order.
 */
export async function listOrders(input: ListOrdersInput): Promise<OrderListItemView[]> {
  const { customer, limit = 20, offset = 0 } = input;

  const orders = await orderRepository.findAll({
    where: { customerId: customer._id },
    sort: { field: "placedAt", order: SortOrder.DESC },
    skip: offset,
    take: limit,
  });

  const orderIds = orders.map((order) => order._id);
  // Direct Model use: `$group` line counts are not expressible through the repository.
  const lineCounts = await OrderLineModel.aggregate([
    { $match: { orderId: { $in: orderIds } } },
    { $group: { _id: "$orderId", count: { $sum: 1 } } },
  ]);

  const lineCountMap = new Map(lineCounts.map((item) => [item._id.toString(), item.count]));

  return orders.map((order) => ({
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    status: order.status,
    paymentStatus: order.payment.status,
    total: order.total,
    itemCount: lineCountMap.get(order._id.toString()) ?? 0,
  }));
}
