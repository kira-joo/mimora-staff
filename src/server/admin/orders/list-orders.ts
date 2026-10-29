import { escapeRegExp } from "@kira-joo/backend-toolkit-mongoose";
import { SortOrder } from "@kira-joo/toolkit-common";
import type { Money, PaginatedResponse } from "@kira-joo/toolkit-common";
import { customerRepository, orderRepository } from "../../core/repositories";
import { OrderLineModel } from "../../commerce/order.schema";
import type { ListAdminOrdersQueryDto } from "../dto/list-admin-orders-query.dto";
import { resolveOrderCustomerNames } from "./order-customer-name";

export interface OrderListItemView {
  _id: string;
  orderNumber: string;
  placedAt: Date;
  status: string;
  paymentStatus: string;
  mode: "DELIVERY" | "PICKUP";
  zone?: string;
  customerId?: string;
  guestName?: string;
  /** Guest name, else the account's, else the delivery recipient — see `resolveOrderCustomerNames`. */
  customerName?: string;
  total: Money;
  itemCount: number;
}

/** Shorter than this is not a search: one character matches half the collection and says nothing. */
const MIN_SEARCH_LENGTH = 2;

/**
 * The `where` clause for a free-text order search, or `undefined` when the text is too short to mean anything.
 *
 * Matches the order number, and the customer by name or phone through every place the order can name one: the guest
 * contact on the order, the delivery recipient on its address snapshot, and — for a signed-in customer — the
 * account itself. The account is looked up first (a small, indexed-by-phone collection) and its ids joined in, so
 * the search stays one query over orders and runs entirely server-side.
 *
 * Case-insensitive substring over escaped text (`escapeRegExp`): a `.` or `(` in the box is a character, never a
 * pattern, and cannot be turned into a regular-expression denial of service.
 */
export async function orderSearchClause(search: string | undefined): Promise<Record<string, unknown> | undefined> {
  const text = search?.trim();
  if (!text || text.length < MIN_SEARCH_LENGTH) return undefined;

  const pattern = new RegExp(escapeRegExp(text), "i");
  const customers = await customerRepository.findAll({ where: { $or: [{ name: pattern }, { phone: pattern }] }, select: { _id: true }, take: 200 });

  return {
    $or: [
      { orderNumber: pattern },
      { guestName: pattern },
      { guestPhone: pattern },
      { "fulfilment.addressSnapshot.recipientName": pattern },
      { "fulfilment.addressSnapshot.phone": pattern },
      ...(customers.length > 0 ? [{ customerId: { $in: customers.map((customer) => customer._id) } }] : []),
    ],
  };
}

/** Board/list filters per MDS §6.2 — status, payment state, mode, date range, zone, customer, and a text search. */
export async function listOrders(query: ListAdminOrdersQueryDto): Promise<PaginatedResponse<OrderListItemView>> {
  const { status, paymentStatus, mode, customerId, zone, placedFrom, placedTo, search, ...rest } = query;
  const where: Record<string, unknown> = {};

  const searchClause = await orderSearchClause(search);
  if (searchClause) Object.assign(where, searchClause);

  if (status) where.status = status;
  if (paymentStatus) where["payment.status"] = paymentStatus;
  if (mode) where["fulfilment.mode"] = mode;
  if (customerId) where.customerId = customerId;
  if (zone) where["fulfilment.zone"] = zone;
  if (placedFrom || placedTo) {
    where.placedAt = {
      ...(placedFrom ? { $gte: new Date(placedFrom) } : {}),
      ...(placedTo ? { $lte: new Date(placedTo) } : {}),
    };
  }

  const result = await orderRepository.findAllAndCountPublic({
    where,
    sort: { field: "placedAt", order: SortOrder.DESC },
    query: rest,
  });

  // OrderLine per-order counts — an aggregation, not a single-entity lookup, so it stays a direct Model call; no generic repository method covers it.
  const orderIds = result.data.map((order) => order._id);
  const lineCounts = await OrderLineModel.aggregate([
    { $match: { orderId: { $in: orderIds } } },
    { $group: { _id: "$orderId", count: { $sum: 1 } } },
  ]);
  const lineCountMap = new Map(lineCounts.map((item) => [item._id.toString(), item.count]));
  const customerNames = await resolveOrderCustomerNames(result.data);

  return {
    ...result,
    data: result.data.map((order) => ({
      _id: order._id.toString(),
      orderNumber: order.orderNumber,
      placedAt: order.placedAt,
      status: order.status,
      paymentStatus: order.payment.status,
      mode: order.fulfilment.mode,
      zone: order.fulfilment.zone,
      customerId: order.customerId?.toString(),
      guestName: order.guestName,
      customerName: customerNames.get(order._id.toString()),
      total: order.total,
      itemCount: lineCountMap.get(order._id.toString()) ?? 0,
    })),
  };
}
