/**
 * Mirrors `OrderSchema.status` exactly (`commerce/order.schema.ts`) — the
 * fulfilment axis, independent of payment. No `REJECTED` value exists here:
 * `CANCELLED` is the sole "did not complete" terminal state for this schema.
 *
 * The plan's lifecycle: placed → confirmed → processing → dispatched (`SHIPPED`)
 * → in transit (`IN_TRANSIT`, optional) → delivered, or ready → collected for a
 * pickup order.
 */
export type OrderStatus =
  | "PLACED"
  | "CONFIRMED"
  | "PROCESSING"
  | "READY_FOR_PICKUP"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "COLLECTED"
  | "CANCELLED";

/**
 * Mirrors `OrderSchema.payment.status` exactly — the payment axis.
 *
 * Method-agnostic names (Phase 4A.5 — renamed from `AWAITING_PROOF`/
 * `PROOF_SUBMITTED`), so a future online-payment method reuses this exact
 * lifecycle: `AWAITING_PAYMENT` covers "waiting for either a manual proof or
 * a provider callback," `SUBMITTED` covers "proof uploaded OR provider
 * webhook received, pending reconciliation." No new state is needed when a
 * real provider integration is added.
 */
export type PaymentStatus = "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";

/** Mirrors `OrderSchema.fulfilment.mode` exactly. */
export type FulfilmentMode = "DELIVERY" | "PICKUP";
