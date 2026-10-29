import { SortOrder } from "@kira-joo/toolkit-common";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { returnRepository, orderRepository } from "../../core/repositories";
import type { ListAdminReturnsQueryDto } from "../dto/list-admin-returns-query.dto";

export interface ReturnListItemView {
  _id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  status: "REQUESTED" | "APPROVED" | "RECEIVED" | "REJECTED" | "REFUNDED";
  reason: string;
  requestedAt: Date;
  processedAt?: Date;
}

export async function listReturns(query: ListAdminReturnsQueryDto): Promise<PaginatedResponse<ReturnListItemView>> {
  const { status, ...rest } = query;
  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const result = await returnRepository.findAllAndCountPublic({
    where,
    sort: { field: "requestedAt", order: SortOrder.DESC },
    query: rest,
  });

  const orders = await orderRepository.findAll({ where: { _id: { $in: result.data.map((r) => r.orderId) } } });
  const orderNumberById = new Map(orders.map((order) => [order._id.toString(), order.orderNumber]));

  return {
    ...result,
    data: result.data.map((ret) => ({
      _id: ret._id.toString(),
      returnNumber: ret.returnNumber,
      orderId: ret.orderId.toString(),
      orderNumber: orderNumberById.get(ret.orderId.toString()) ?? "",
      status: ret.status,
      reason: ret.reason,
      requestedAt: ret.requestedAt,
      processedAt: ret.processedAt,
    })),
  };
}
