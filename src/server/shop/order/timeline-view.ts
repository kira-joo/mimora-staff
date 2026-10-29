import type { OrderSchema, OrderTimelineEventType } from "../../commerce/order.schema";
import type { OrderTimelineView } from "./order.types";

/**
 * Which timeline event types a customer sees. Every type is classified
 * explicitly — a new `OrderTimelineEventType` fails to compile until someone
 * decides, so an internal event can never leak by default.
 */
const CUSTOMER_VISIBLE: Record<OrderTimelineEventType, boolean> = {
  // Status progress — the order's visible journey.
  ORDER_PLACED: true,
  ORDER_CONFIRMED: true,
  ORDER_PROCESSING: true,
  ORDER_READY_FOR_PICKUP: true,
  ORDER_SHIPPED: true,
  ORDER_IN_TRANSIT: true,
  ORDER_DELIVERED: true,
  ORDER_COLLECTED: true,
  ORDER_CANCELLED: true,
  // Staff correcting a carrier or tracking number: the customer sees the tracking itself, not the edit history.
  ORDER_TRACKING_UPDATED: false,
  // Payment progress — the customer submitted, or is told the outcome of, a proof.
  PAYMENT_SUBMITTED: true,
  PAYMENT_VERIFIED: true,
  PAYMENT_REJECTED: true,
  PAYMENT_REFUNDED: true,
  // Returns and refunds-of-returns live on their own `/api/shop/returns` surface
  // with their own customer views; they are not part of the order's own timeline.
  RETURN_REQUESTED: false,
  RETURN_APPROVED: false,
  RETURN_REJECTED: false,
  RETURN_RECEIVED: false,
  REFUND_ISSUED: false,
};

/**
 * The customer-safe timeline: chronological `{ type, at }` and nothing else.
 * Never `actorId`/`actorType` (a staff member's identity), `metadata`
 * (free-form, internal), or `reason` — the schema keeps ONE `reason` field
 * that carries staff-written text (a rejection reason, a staff cancellation
 * note), with no customer-facing variant to tell them apart, so reasons are
 * excluded here entirely. (A payment rejection reason reaches the customer
 * through `payment.rejectionReason`, deliberately, on its own field.)
 */
export function buildTimelineView(timeline: OrderSchema["timeline"] | undefined): OrderTimelineView {
  return (timeline ?? [])
    .filter((entry) => CUSTOMER_VISIBLE[entry.type] === true)
    .map((entry) => ({ type: entry.type as OrderTimelineView[number]["type"], at: entry.at }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}
