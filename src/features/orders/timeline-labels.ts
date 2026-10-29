import type { OrderTimelineEventType } from "src/server/commerce/order.schema";

/**
 * Typed over the server's own event union, so an event the server writes and the console doesn't label — or a label
 * for an event that doesn't exist, which is how `PAYMENT_PROOF_SUBMITTED` hid for a while beside the real
 * `PAYMENT_SUBMITTED` — is a compile error rather than a quietly humanised fallback.
 */
export const TIMELINE_LABEL: Record<OrderTimelineEventType, string> = {
  ORDER_PLACED: "Order placed",
  ORDER_CONFIRMED: "Confirmed",
  ORDER_PROCESSING: "Processing started",
  ORDER_READY_FOR_PICKUP: "Ready for pickup",
  ORDER_SHIPPED: "Shipped",
  ORDER_IN_TRANSIT: "In transit",
  ORDER_DELIVERED: "Delivered",
  ORDER_COLLECTED: "Collected",
  ORDER_TRACKING_UPDATED: "Tracking updated",
  ORDER_CANCELLED: "Cancelled",
  PAYMENT_SUBMITTED: "Payment proof submitted",
  PAYMENT_VERIFIED: "Payment verified",
  PAYMENT_REJECTED: "Payment rejected",
  PAYMENT_REFUNDED: "Payment refunded",
  RETURN_REQUESTED: "Return requested",
  RETURN_APPROVED: "Return approved",
  RETURN_REJECTED: "Return rejected",
  RETURN_RECEIVED: "Return received",
  REFUND_ISSUED: "Refund recorded",
};

const humanize = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");

/** The event's label — a type this console has never heard of (an older client against a newer server) falls back to a readable form. */
export const timelineEventLabel = (type: string): string => (TIMELINE_LABEL as Record<string, string | undefined>)[type] ?? humanize(type);

/**
 * Who acted. A staff entry names the member the server resolved from `actorId`; when that account has since been
 * removed there is no name to show, and saying so is better than a bare "Staff" that reads as unattributed.
 */
export function timelineActorLabel(entry: { actorType: "STAFF" | "CUSTOMER" | "SYSTEM"; actorName?: string }): string {
  if (entry.actorType === "STAFF") return entry.actorName ?? "Staff (account removed)";
  return humanize(entry.actorType);
}
