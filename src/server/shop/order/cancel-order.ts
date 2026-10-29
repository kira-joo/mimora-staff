import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { fulfilmentSettingsRepository, orderRepository } from "../../core/repositories";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { assertTransition, canCustomerCancel, releasesStock } from "../../engines/order-state/order-state-machine";
import { releaseOrderStock } from "../../commerce/release-order-stock";
import mongoose from "mongoose";
import { orderOwnerFilter, type OrderOwner } from "./order-access";

export type CancelOrderInput = OrderOwner & {
  orderNumber: string;
  reason?: string;
  now: Date;
};

/**
 * Cancels an order for `POST /api/shop/orders/[orderNumber]/cancel`.
 *
 * Validates:
 * - Order exists and belongs to this owner (a customer, or a guest holding the order's access token)
 * - Current status allows customer cancellation
 * - Within the order's own cancellation deadline (`Order.customerCancelUntil`, snapshotted at placement);
 *   orders placed before that existed fall back to FulfilmentSettings.customerCancelWindowMinutes
 *
 * Transactionally:
 * - Transitions status to CANCELLED (via order-state-machine.assertTransition)
 * - Restores stock if status was holding stock (via releasesStock check)
 * - Appends to order timeline via the one typed append point (`appendOrderTimelineEntry`)
 * - Maintains product listing rollup for affected products
 *
 * Returns { success: true } on success.
 */
export async function cancelOrder(input: CancelOrderInput): Promise<{ success: boolean }> {
  const { customer, orderNumber, reason, now } = input;

  // Reason is optional from the customer's perspective (CancelOrderDto), but
  // order-state-machine.REASON_REQUIRED mandates one on every CANCELLED
  // transition — it is shown to the customer verbatim, so a generic default
  // stands in for an unspecified one rather than the transition failing.
  const cancelReason = reason?.trim() || "Cancelled by customer";

  // Read order outside transaction for ownership + time window checks
  const order = await orderRepository.findOne({ where: orderOwnerFilter(input, orderNumber), skipThrowError: true });

  if (!order) {
    throw new NotFoundError("Order not found.");
  }

  // Check time window. The deadline snapshotted onto the order at placement wins; the current setting is only the
  // fallback for orders placed before it was recorded.
  const fulfilmentSettings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  const cancelWindowMinutes = fulfilmentSettings?.customerCancelWindowMinutes ?? 30;

  if (!canCustomerCancel(order.status, order.placedAt, now, cancelWindowMinutes, order.customerCancelUntil)) {
    throw new ConflictError("This order can no longer be cancelled.");
  }

  return withTransaction(async (tx) => {
    // Assert transition is valid
    assertTransition({
      from: order.status,
      to: "CANCELLED",
      mode: order.fulfilment.mode,
      paymentStatus: order.payment.status,
      reason: cancelReason,
    });

    // Update order status
    await orderRepository.updateAtomic({ _id: order._id }, { $set: { status: "CANCELLED" } }, { skipThrowError: true });

    // Append to timeline through the one typed append point — never a raw
    // `$push` literal (see order.schema.ts's own doc comment on why).
    await appendOrderTimelineEntry(order._id, {
      type: "ORDER_CANCELLED",
      at: now,
      actorType: "CUSTOMER",
      actorId: customer ? new mongoose.Types.ObjectId(customer._id) : undefined,
      reason: cancelReason,
    });

    // Restore stock if this transition releases stock
    if (releasesStock(order.status, "CANCELLED")) {
      await releaseOrderStock(order._id, { actorId: customer ? new mongoose.Types.ObjectId(customer._id) : undefined, at: now });
    }

    return tx.complete({ success: true });
  });
}
