import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { SortOrder } from "@kira-joo/toolkit-common";
import { orderLineRepository, orderRepository } from "../../core/repositories";
import { buildPackingSlip, type PackingSlipView } from "../../engines/fulfilment-documents/packing-slip";
import { buildPickingList, type PickingListView } from "../../engines/fulfilment-documents/picking-list";

/** A printable packing slip for one order. 404 for an unknown order. */
export async function getPackingSlip(orderId: string): Promise<PackingSlipView> {
  const order = await orderRepository.findOne({ where: { _id: orderId } });
  const lines = await orderLineRepository.findAll({ where: { orderId: order._id }, sort: { field: "lineNumber", order: SortOrder.ASC } });
  return buildPackingSlip({ order, lines });
}

/**
 * A picking list for the selected orders. Ids that match no order are reported rather than dropped silently — a
 * picking list that quietly omits an order is a parcel that ships short — and the request is a 404 only when none of
 * the ids is an order at all.
 */
export async function getPickingList(orderIds: readonly string[]): Promise<PickingListView & { missing: string[] }> {
  const orders = await orderRepository.findAll({ where: { _id: { $in: [...orderIds] } } });
  if (orders.length === 0) throw new NotFoundError("None of the selected orders exist.");

  const lines = await orderLineRepository.findAll({ where: { orderId: { $in: orders.map((order) => order._id) } }, sort: { field: "lineNumber", order: SortOrder.ASC } });
  const linesByOrder = new Map<string, typeof lines>();
  for (const line of lines) {
    const key = line.orderId.toString();
    linesByOrder.set(key, [...(linesByOrder.get(key) ?? []), line]);
  }

  const found = new Set(orders.map((order) => order._id.toString()));
  return {
    ...buildPickingList(orders.map((order) => ({ order, lines: linesByOrder.get(order._id.toString()) ?? [] }))),
    missing: orderIds.filter((id) => !found.has(id)),
  };
}
