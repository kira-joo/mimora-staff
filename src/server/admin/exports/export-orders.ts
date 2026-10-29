import { MONEY_SCALE, SortOrder, toMoney } from "@kira-joo/toolkit-common";
import { orderRepository } from "../../core/repositories";
import { OrderLineModel } from "../../commerce/order.schema";
import type { ListAdminOrdersQueryDto } from "../dto/list-admin-orders-query.dto";
import { EXPORT_PAGE_SIZE } from "./export-customers";
import { numberCell, pageByIdCursor, type CsvExport } from "./csv";

export const ORDER_EXPORT_HEADER = [
  "Order number", "Placed at", "Order status", "Payment status", "Payment method", "Fulfilment", "Zone", "Customer", "Guest name", "Customer ID", "Items", "Subtotal", "Discount", "Shipping", "Tax", "Total",
] as const;

/**
 * The order list's filters, as the list applies them (`listOrders`). Kept beside the
 * list's behaviour by `exports.integration.test.ts`, which asserts a filtered export
 * and the filtered list return the same orders.
 */
export function buildOrderFilter(query: ListAdminOrdersQueryDto): Record<string, unknown> {
  const { status, paymentStatus, mode, customerId, zone, placedFrom, placedTo } = query;
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (paymentStatus) where["payment.status"] = paymentStatus;
  if (mode) where["fulfilment.mode"] = mode;
  if (customerId) where.customerId = customerId;
  if (zone) where["fulfilment.zone"] = zone;
  if (placedFrom || placedTo) {
    where.placedAt = { ...(placedFrom ? { $gte: new Date(placedFrom) } : {}), ...(placedTo ? { $lte: new Date(placedTo) } : {}) };
  }
  return where;
}

/** Money at the scale amounts are paid and stored at, always — `10` is `10.00`, so a column sums and sorts as text and as number. */
const money = (value: unknown) => numberCell(toMoney(String(value ?? "0")).toFixed(MONEY_SCALE));

export function exportOrders(query: ListAdminOrdersQueryDto): CsvExport {
  const filter = buildOrderFilter(query);
  const pages = pageByIdCursor(
    (after) =>
      orderRepository.findAll({
        where: after ? { ...filter, _id: { $gt: after } } : filter,
        sort: { field: "_id", order: SortOrder.ASC },
        take: EXPORT_PAGE_SIZE,
      }),
    EXPORT_PAGE_SIZE
  );

  return {
    filename: "orders",
    header: ORDER_EXPORT_HEADER,
    rows: (async function* () {
      for await (const page of pages) {
        // Line counts for this page of orders in one aggregation — the same per-order count the list shows.
        const counts = new Map(
          (await OrderLineModel.aggregate([{ $match: { orderId: { $in: page.map((order) => order._id) } } }, { $group: { _id: "$orderId", count: { $sum: 1 } } }])).map((row) => [row._id.toString(), row.count as number])
        );
        for (const order of page) {
          yield [
            order.orderNumber,
            order.placedAt,
            order.status,
            order.payment.status,
            order.payment.method,
            order.fulfilment.mode === "DELIVERY" ? "Delivery" : "Pickup",
            order.fulfilment.zone,
            order.customerId ? "Registered" : "Guest",
            order.guestName,
            order.customerId?.toString(),
            numberCell(counts.get(order._id.toString()) ?? 0),
            money(order.subtotal),
            money(order.discount),
            money(order.fulfilment.fee),
            money(order.tax),
            money(order.total),
          ] as const;
        }
      }
    })(),
  };
}
