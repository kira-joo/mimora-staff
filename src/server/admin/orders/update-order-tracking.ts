import { ConflictError, ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { fulfilmentSettingsRepository, orderRepository } from "../../core/repositories";
import type { OrderStatus } from "../../engines/order-state/order-state.types";
import { buildTrackingSnapshot, type TrackingInput } from "../../fulfilment/carrier-tracking";

export interface UpdateOrderTrackingInput {
  orderId: string;
  tracking: TrackingInput;
  staffId: string;
  now: Date;
}

/** Tracking exists from the moment a delivery order is handed to a courier; a correction is still useful after delivery. */
const TRACKING_EDITABLE: readonly OrderStatus[] = ["SHIPPED", "IN_TRANSIT", "DELIVERED"];

/**
 * Add or correct the carrier and tracking number on a shipped order.
 *
 * On the way out (`transitionOrderStatus` to SHIPPED) tracking is optional; here it is the whole point, so carrier
 * AND number are both required. The order keeps a snapshot — the carrier's name and the resolved link as they are
 * NOW — and the change is recorded on the timeline (`ORDER_TRACKING_UPDATED`) with the staff member and the values
 * before and after: the audit trail for a link a customer may already have followed.
 *
 * The write guards on the status read before it, so a transition landing in between is a conflict, not a lost update.
 */
export async function updateOrderTracking(input: UpdateOrderTrackingInput) {
  const { orderId, tracking, staffId, now } = input;

  const order = await orderRepository.findOne({ where: { _id: orderId } });
  if (!TRACKING_EDITABLE.includes(order.status) || order.fulfilment.mode !== "DELIVERY") {
    throw new ConflictError("Tracking can only be set on a delivery order that has been shipped.");
  }

  const settings = await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  const snapshot = buildTrackingSnapshot(tracking, settings?.carriers ?? []);
  if (!snapshot) {
    throw new ValidationFailedError([
      { field: "carrierKey", messages: ["Choose a carrier."] },
      { field: "trackingNumber", messages: ["Enter the tracking number."] },
    ]);
  }

  const staffObjectId = new mongoose.Types.ObjectId(staffId);
  const previous = order.tracking ? { carrierName: order.tracking.carrierName, trackingNumber: order.tracking.trackingNumber, url: order.tracking.url } : undefined;

  return withTransaction(async (tx) => {
    await orderRepository.updateAtomic(
      { _id: order._id, status: order.status },
      { $set: { tracking: { ...snapshot, updatedAt: now, updatedBy: staffObjectId } } }
    );

    await appendOrderTimelineEntry(order._id, {
      type: "ORDER_TRACKING_UPDATED",
      at: now,
      actorType: "STAFF",
      actorId: staffObjectId,
      metadata: { previous, current: { carrierName: snapshot.carrierName, trackingNumber: snapshot.trackingNumber, url: snapshot.url } },
    });

    const updated = await orderRepository.findOne({ where: { _id: order._id } });
    return tx.complete(updated);
  });
}
