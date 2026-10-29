import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { SortOrder } from "@kira-joo/toolkit-common";
import { fulfilmentSettingsRepository, orderLineRepository, orderRepository, variantRepository } from "../../core/repositories";
import { canCustomerCancel } from "../../engines/order-state/order-state-machine";
import { orderOwnerFilter, type OrderOwner } from "./order-access";
import { buildPaymentView } from "./payment-view";
import { buildTimelineView } from "./timeline-view";
import type { OrderDetailView } from "./order.types";

export type GetOrderDetailInput = OrderOwner & {
  orderNumber: string;
  now: Date;
};

/**
 * Retrieves full order detail for `GET /api/shop/orders/[orderNumber]`.
 *
 * Returns the order with all lines, fulfilment snapshot, payment status, and
 * `canCancel` flag derived from current status + time window.
 *
 * Works for a customer's order and a guest's (`guestOrderId`). Throws
 * NotFoundError if the order doesn't exist or isn't this owner's — never
 * reveal another owner's order.
 */
export async function getOrderDetail(input: GetOrderDetailInput): Promise<OrderDetailView> {
  const { orderNumber, now } = input;

  const order = await orderRepository.findOne({ where: orderOwnerFilter(input, orderNumber), skipThrowError: true });

  if (!order) {
    throw new NotFoundError("Order not found.");
  }

  const lines = await orderLineRepository.findAll({
    where: { orderId: order._id },
    sort: { field: "lineNumber", order: SortOrder.ASC },
  });

  // Lines placed before productId was snapshotted: resolve it from their variant (one query, only when needed).
  const unresolved = lines.filter((line) => !line.productId).map((line) => line.variantId.toString());
  const productIdByVariant = new Map<string, string>();
  if (unresolved.length > 0) {
    const variants = await variantRepository.findByIds(unresolved);
    for (const variant of variants) productIdByVariant.set(variant._id.toString(), variant.productId.toString());
  }

  // Derive canCancel — requires fulfilment settings for the time window
  const fulfilmentSettings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  const cancelWindowMinutes = fulfilmentSettings?.customerCancelWindowMinutes ?? 30;

  const canCancel = canCustomerCancel(order.status, order.placedAt, now, cancelWindowMinutes, order.customerCancelUntil);

  return {
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    placedAt: order.placedAt,
    status: order.status,
    paymentStatus: order.payment.status,
    lines: lines.map((line) => ({
      orderLineId: line._id.toString(),
      lineNumber: line.lineNumber,
      variantId: line.variantId.toString(),
      // Snapshotted since 2026-10-20; older lines resolve through their variant.
      productId: line.productId?.toString() ?? productIdByVariant.get(line.variantId.toString()) ?? null,
      sku: line.sku,
      productName: line.productName,
      variantDescription: line.variantDescription,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    })),
    subtotal: order.subtotal,
    discount: order.discount,
    tax: order.tax,
    total: order.total,
    fulfilment: {
      mode: order.fulfilment.mode,
      fee: order.fulfilment.fee,
      zone: order.fulfilment.zone,
      dispatchBy: order.fulfilment.dispatchBy,
      promisedWindow: order.fulfilment.promisedWindow,
      addressSnapshot: order.fulfilment.addressSnapshot,
      pickupLocationSnapshot: order.fulfilment.pickupLocationSnapshot,
    },
    payment: buildPaymentView(order.payment),
    ...(order.notes ? { notes: order.notes } : {}),
    ...(order.tracking ? { tracking: { carrierName: order.tracking.carrierName, trackingNumber: order.tracking.trackingNumber, url: order.tracking.url } } : {}),
    ...(order.invoiceNumber ? { invoiceNumber: order.invoiceNumber } : {}),
    timeline: buildTimelineView(order.timeline),
    canCancel,
  };
}

