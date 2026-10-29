import { SortOrder } from "@kira-joo/toolkit-common";
import type { Money } from "@kira-joo/toolkit-common";
import { orderRepository } from "../../core/repositories";
import { OrderLineModel } from "../../commerce/order.schema";
import type { OrderStatus } from "../../engines/order-state/order-state.types";
import type { BoardOrdersQueryDto } from "../dto/board-orders-query.dto";
import { orderSearchClause } from "./list-orders";
import { resolveOrderCustomerNames } from "./order-customer-name";

/**
 * The statuses an order is WORKED in, left to right in the order a delivery or pickup order passes through them.
 * Completed (DELIVERED / COLLECTED) and CANCELLED orders are not work: they stay on the list, where they can be
 * filtered and searched, rather than crowding a board whose job is "what needs a hand right now".
 */
export const BOARD_STATUSES = ["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT"] as const satisfies readonly OrderStatus[];

/** Cards per column. A column over the cap says how many more there are and links to the list; it never silently truncates. */
export const BOARD_COLUMN_LIMIT = 40;

export interface BoardCard {
  _id: string;
  orderNumber: string;
  placedAt: Date;
  status: OrderStatus;
  paymentStatus: string;
  mode: "DELIVERY" | "PICKUP";
  zone?: string;
  customerName?: string;
  total: Money;
  itemCount: number;
  /** The date by which the order is promised to leave; the board sorts the oldest first, this says why one is urgent. */
  dispatchBy?: Date;
}

export interface BoardColumn {
  status: OrderStatus;
  /** Every order in this status matching the filters — may exceed `orders.length` (see `BOARD_COLUMN_LIMIT`). */
  total: number;
  orders: BoardCard[];
}

/**
 * The orders board: one column per working status, oldest order first within a column (the one that has waited
 * longest is the one to touch next). Filters narrow every column at once: fulfilment mode, and the same text search
 * the list uses.
 */
export async function getOrdersBoard(query: BoardOrdersQueryDto): Promise<{ columns: BoardColumn[] }> {
  const searchClause = await orderSearchClause(query.search);

  const fetched = await Promise.all(
    BOARD_STATUSES.map(async (status) => {
      const where: Record<string, unknown> = { status, ...(query.mode ? { "fulfilment.mode": query.mode } : {}), ...(searchClause ?? {}) };
      const [docs, total] = await Promise.all([
        orderRepository.findAll({ where, sort: { field: "placedAt", order: SortOrder.ASC }, take: BOARD_COLUMN_LIMIT }),
        orderRepository.count({ where }),
      ]);
      return { status, total, docs };
    })
  );

  const all = fetched.flatMap((column) => column.docs);
  const [lineCounts, names] = await Promise.all([
    OrderLineModel.aggregate([{ $match: { orderId: { $in: all.map((order) => order._id) } } }, { $group: { _id: "$orderId", count: { $sum: 1 } } }]),
    resolveOrderCustomerNames(all),
  ]);
  const lineCountMap = new Map(lineCounts.map((item) => [item._id.toString(), item.count as number]));

  return {
    columns: fetched.map(({ status, total, docs }) => ({
      status,
      total,
      orders: docs.map(
        (order): BoardCard => ({
          _id: order._id.toString(),
          orderNumber: order.orderNumber,
          placedAt: order.placedAt,
          status: order.status,
          paymentStatus: order.payment.status,
          mode: order.fulfilment.mode,
          zone: order.fulfilment.zone,
          customerName: names.get(order._id.toString()),
          total: order.total,
          itemCount: lineCountMap.get(order._id.toString()) ?? 0,
          dispatchBy: order.fulfilment.dispatchBy,
        })
      ),
    })),
  };
}
