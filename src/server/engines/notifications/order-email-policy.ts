import type { OrderEmailKind } from "../../core/mail/templates/order-emails";

/**
 * Which order timeline events email the customer, and whether the merchant
 * has switched that on.
 *
 * `NotificationSettings.events[].event` is the merchant's own free-text key;
 * the key this policy reads is the timeline event's own type name
 * (`ORDER_SHIPPED`, `PAYMENT_REJECTED`, …), the vocabulary the Notifications
 * settings screen suggests ("e.g. ORDER_PLACED").
 *
 * **An event not listed here sends nothing.** That is the default for every
 * event type added later (IN_TRANSIT, …): a new lifecycle step must
 * be given a message on purpose, not start emailing customers because someone
 * added an enum member.
 */
const ORDER_EMAIL_FOR_EVENT: Readonly<Record<string, OrderEmailKind>> = {
  ORDER_PLACED: "order-placed",
  ORDER_CONFIRMED: "order-confirmed",
  PAYMENT_VERIFIED: "payment-verified",
  PAYMENT_REJECTED: "payment-rejected",
  ORDER_SHIPPED: "order-shipped",
  ORDER_READY_FOR_PICKUP: "order-ready-for-pickup",
  // The last step of a pickup order. DELIVERED would be a false message for it: nothing was delivered.
  ORDER_COLLECTED: "order-collected",
  ORDER_DELIVERED: "order-delivered",
  ORDER_CANCELLED: "order-cancelled",
  // Both ways a refund is recorded: a payment refund, and a refund of a return.
  PAYMENT_REFUNDED: "refund-recorded",
  REFUND_ISSUED: "refund-recorded",
};

/** The email a timeline event sends, or `null` — an unknown or unlisted event is "no email". */
export function orderEmailKindForEvent(eventType: string): OrderEmailKind | null {
  return Object.prototype.hasOwnProperty.call(ORDER_EMAIL_FOR_EVENT, eventType) ? ORDER_EMAIL_FOR_EVENT[eventType]! : null;
}

/** Every event type that can email a customer — for documentation and for the mapping test. */
export const EMAILING_EVENT_TYPES: readonly string[] = Object.keys(ORDER_EMAIL_FOR_EVENT);

/**
 * What the console shows for each supported event key, in the order a customer meets them. The settings screen offers
 * exactly these as a choice (a free-text key can only ever be a typo or a dead rule), so this table and
 * `ORDER_EMAIL_FOR_EVENT` must name the same events — `notification-policies.test.ts` asserts it.
 */
export const ORDER_EMAIL_EVENT_LABELS: Readonly<Record<string, string>> = {
  ORDER_PLACED: "Order placed",
  ORDER_CONFIRMED: "Order confirmed",
  PAYMENT_VERIFIED: "Payment verified",
  PAYMENT_REJECTED: "Payment rejected",
  ORDER_SHIPPED: "Order shipped",
  ORDER_READY_FOR_PICKUP: "Ready for pickup",
  ORDER_COLLECTED: "Collected (pickup)",
  ORDER_DELIVERED: "Order delivered",
  ORDER_CANCELLED: "Order cancelled",
  PAYMENT_REFUNDED: "Payment refunded",
  REFUND_ISSUED: "Return refund issued",
};

export interface NotificationEventSetting {
  event: string;
  channels: readonly string[];
}

/**
 * True only when the merchant has a rule for this event with EMAIL ticked.
 * No settings document, no rule for the event, or a rule without EMAIL: no
 * email — switching a channel on is the merchant's act, never a default.
 */
export function isEmailEnabledFor(events: readonly NotificationEventSetting[] | undefined | null, eventType: string): boolean {
  return (events ?? []).some((rule) => rule.event === eventType && rule.channels.includes("EMAIL"));
}
