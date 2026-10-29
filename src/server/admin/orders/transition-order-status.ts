import { ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { fulfilmentSettingsRepository, orderRepository } from "../../core/repositories";
import { buildTrackingSnapshot, type TrackingInput } from "../../fulfilment/carrier-tracking";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { assertTransition, releasesStock, timelineEventForStatus } from "../../engines/order-state/order-state-machine";
import type { OrderStatus } from "../../engines/order-state/order-state.types";
import { releaseOrderStock } from "../../commerce/release-order-stock";

export interface TransitionOrderStatusInput {
  orderId: string;
  to: Exclude<OrderStatus, "PLACED">;
  reason?: string;
  /** Carrier + tracking number. Optional, validated together, and accepted only when `to` is SHIPPED. */
  tracking?: TrackingInput;
  staffId: string;
  now: Date;
}

/**
 * The one admin entry point for every fulfilment-status change — confirm,
 * process, ship, mark ready/delivered, cancel, and "reject" (per
 * `order-state-machine.ts`'s own doc comment: reject is CANCELLED from
 * PLACED with a reason, not a second engine concept). One generic
 * transition through `assertTransition` rather than a route per target
 * status, matching the engine's own "one map, one place" design.
 *
 * Mirrors `shop/order/cancel-order.ts`'s transactional shape (stock
 * release via the shared `releaseOrderStock` on any transition that releases stock),
 * generalized to an arbitrary target status and a STAFF actor instead of
 * a customer-owned, window-gated cancel.
 *
 * The status write goes through `updateAtomic` with the pre-read status
 * folded into the filter (`{ _id, status: order.status }`) — the same
 * predicate-in-the-filter shape the constitution requires for oversell
 * prevention, here guarding against two staff transitioning the same
 * order at once. `updateAtomic` returns the updated document directly,
 * so there's no separate re-fetch after the write.
 */
export async function transitionOrderStatus(input: TransitionOrderStatusInput) {
  const { orderId, to, reason, staffId, now } = input;

  const order = await orderRepository.findOne({ where: { _id: orderId } });

  /*
   * Tracking is resolved BEFORE the transaction opens: it reads settings, validates, and can refuse — none of which
   * belongs in a transaction that is retried on contention. Entered on any step but the hand-over to the courier it
   * is refused rather than silently dropped, so a client that thinks it recorded a tracking number is told it did not.
   */
  const enteredTracking = Boolean(input.tracking?.carrierKey?.trim() || input.tracking?.trackingNumber?.trim());
  if (enteredTracking && to !== "SHIPPED") {
    throw new ValidationFailedError([{ field: "trackingNumber", messages: ["Tracking can only be entered when the order is marked shipped. Use the tracking update once it has shipped."] }]);
  }
  const settings = enteredTracking ? await fulfilmentSettingsRepository.findOne({ where: {}, skipThrowError: true }) : null;
  const snapshot = enteredTracking ? buildTrackingSnapshot(input.tracking!, settings?.carriers ?? []) : undefined;
  const staffObjectId = new mongoose.Types.ObjectId(staffId);

  return withTransaction(async (tx) => {
    assertTransition({ from: order.status, to, mode: order.fulfilment.mode, paymentStatus: order.payment.status, reason });

    await orderRepository.updateAtomic(
      { _id: order._id, status: order.status, "payment.status": order.payment.status },
      { $set: { status: to, ...(snapshot ? { tracking: { ...snapshot, updatedAt: now, updatedBy: staffObjectId } } : {}) } }
    );

    await appendOrderTimelineEntry(order._id, {
      type: timelineEventForStatus(to),
      at: now,
      actorType: "STAFF",
      actorId: staffObjectId,
      reason,
      // Staff-only (the customer timeline carries type + time alone); lets the notifier name the carrier without re-reading the order.
      ...(snapshot ? { metadata: { carrierName: snapshot.carrierName, trackingNumber: snapshot.trackingNumber, trackingUrl: snapshot.url } } : {}),
    });

    if (releasesStock(order.status, to)) {
      await releaseOrderStock(order._id, { actorId: staffObjectId, at: now });
    }

    // Two sequential writes land in this transaction (the status $set above,
    // the timeline $push in appendOrderTimelineEntry) — the returned document
    // has to reflect both, so this re-read is real, not the redundant
    // create/update-then-refetch pattern a single-write case would have.
    const updated = await orderRepository.findOne({ where: { _id: order._id } });
    return tx.complete(updated);
  });
}
