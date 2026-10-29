import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { OrderTimelineEventType } from "../../commerce/order.schema";
import type { FulfilmentMode, OrderStatus, PaymentStatus } from "./order-state.types";

/**
 * Every transition the order lifecycle permits.
 *
 * An explicit map rather than scattered `if` statements in route handlers. The
 * difference matters: with a map, "can an order go from READY_FOR_PICKUP back
 * to PROCESSING?" has one answer in one place, and adding a state forces every
 * edge to be considered. Spread across handlers, the same question has as many
 * answers as there are handlers, and they drift.
 *
 * Deliberately NOT reversible. Once staff have told a customer the order is
 * ready, walking that back is a phone call rather than a status change — and
 * an "undo" would need to reason about notifications already sent.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PLACED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY_FOR_PICKUP", "SHIPPED", "CANCELLED"],
  // Pickup ends in COLLECTED, never DELIVERED: nothing was delivered.
  READY_FOR_PICKUP: ["COLLECTED", "CANCELLED"],
  // IN_TRANSIT is an optional step: a courier hand-over may go straight to DELIVERED.
  SHIPPED: ["IN_TRANSIT", "DELIVERED", "CANCELLED"],
  IN_TRANSIT: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  COLLECTED: [],
  CANCELLED: [],
};

/**
 * The two "the customer has their goods" states: DELIVERED (a delivery order) and COLLECTED (a pickup order).
 *
 * Every rule that asks "did this order complete?" — a review needs a completed order, a return window starts at
 * completion, a customer can no longer cancel — asks THIS, never `=== "DELIVERED"`. A pickup order completed as
 * DELIVERED before COLLECTED existed stays valid and is covered by the same test; there is no migration.
 */
const COMPLETED_STATUSES: readonly OrderStatus[] = ["DELIVERED", "COLLECTED"];

export function isCompletedStatus(status: OrderStatus): boolean {
  return COMPLETED_STATUSES.includes(status);
}

/**
 * **Decision (Phase 4B foundation-completion pass): "reject" an admin order
 * action is `CANCELLED` from `PLACED`, with a reason — not a separate
 * status, and not a separate permission from `ORDER.CANCEL`.**
 *
 * The canonical route inventory (drafted before this schema existed in its
 * current form) named a distinct admin "reject" action alongside "cancel."
 * Checked against the actual domain: `OrderStatus` has no `REJECTED`
 * value, `CANCELLED` is the sole "will not be fulfilled" terminal state
 * (see `OrderStatus`'s own doc comment), and every piece of information a
 * "reject" needs to carry — who did it, when, why — is already captured by
 * the existing `reason` (required on `CANCELLED`, `REASON_REQUIRED` above)
 * and `Order.timeline[].actorType`/`reason` fields. A customer reading
 * "your order was cancelled" versus "your order was rejected by the
 * merchant" is a wording choice for whatever surfaces the message
 * (Phase 5 Staff UI copy, Phase 6 Storefront copy, or a route computing a
 * display label from `from === "PLACED"`), not a fact this domain model
 * needs a second status or a second permission to represent.
 *
 * Introducing a `REJECTED` status would mean: a second terminal
 * "did-not-complete" state with identical semantics to `CANCELLED`
 * (nothing in `releasesStock`, `canCustomerCancel`, or anywhere else in
 * this engine would ever treat them differently), a second entry in
 * `REASON_REQUIRED`, a second `CustomPermission` key duplicating
 * `ORDER_CANCEL`'s exact sensitivity — for zero behavioural gain. That
 * fails "do not invent a new status unless the domain actually requires
 * one."
 *
 * **What a Phase 4B admin "reject" route/DTO should do**: call the same
 * `ORDER.CANCEL` machinery (`assertTransition` to `CANCELLED`, reason
 * required) this engine already provides, with `from === "PLACED"` as the
 * signal (if the route wants to distinguish "reject an unconfirmed order"
 * from "cancel a confirmed one" in its own naming/copy) — not a new engine
 * concept.
 */

/**
 * Transitions that must carry a reason.
 *
 * A cancellation without one is a dead end for the customer, who is told the
 * order will not happen and given nothing to act on. The reason is shown to
 * them verbatim.
 */
const REASON_REQUIRED: readonly OrderStatus[] = ["CANCELLED"];

/**
 * Fulfilment states that hold decremented stock from placement until the
 * order completes. Used by `releasesStock` below.
 */
const STOCK_HOLDING_STATUSES: readonly OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "READY_FOR_PICKUP",
  "SHIPPED",
  "IN_TRANSIT",
];

/**
 * The hand-over states: the order leaves the merchant's control (SHIPPED to a
 * courier, IN_TRANSIT while it moves, READY_FOR_PICKUP to a customer who will
 * collect it, DELIVERED / COLLECTED as the completed hand-over). Payment must
 * be settled before any of them.
 *
 * READY_FOR_PICKUP is gated like SHIPPED on purpose: a pickup customer told
 * "your order is ready" would collect unpaid goods, and the owner's rule is
 * that a proof-required order is not handed over until payment is verified.
 * (`docs/MDS.md` §7 names no exception; it is also the one state a pickup
 * order passes through before DELIVERED, so leaving it open would only move
 * the unpaid hand-over one step earlier.)
 */
const PAYMENT_GATED_STATUSES: readonly OrderStatus[] = ["SHIPPED", "IN_TRANSIT", "READY_FOR_PICKUP", "DELIVERED", "COLLECTED"];

/**
 * Payment statuses that do not stand in the way of a hand-over.
 *
 * `NOT_REQUIRED` is COD (collected at the door); `VERIFIED` is a transfer /
 * InstaPay / wallet payment staff have checked. Everything else — awaiting,
 * submitted-but-unchecked, rejected, refunded — means the money is not in.
 * Stated as the allow-list so a payment status added later is refused by
 * default rather than shipped by accident.
 */
const PAYMENT_SETTLED_STATUSES: readonly PaymentStatus[] = ["NOT_REQUIRED", "VERIFIED"];

/**
 * The payment rule, kept separate from the allowed-transitions map: order and
 * payment are independent axes (a COD order progresses while unpaid), so the
 * map says which fulfilment edges exist and this says when a hand-over edge
 * may be taken. Cancellation and the pre-hand-over steps are never gated.
 */
export function paymentAllowsTransition(to: OrderStatus, paymentStatus: PaymentStatus): boolean {
  if (!PAYMENT_GATED_STATUSES.includes(to)) return true;
  return PAYMENT_SETTLED_STATUSES.includes(paymentStatus);
}

export interface TransitionContext {
  from: OrderStatus;
  to: OrderStatus;
  mode: FulfilmentMode;
  /** The order's current `payment.status`. Required so no caller can validate a transition without the payment rule. */
  paymentStatus: PaymentStatus;
  reason?: string;
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** The states an order may move to next, for building the board's one-tap action. */
export function nextStatuses(from: OrderStatus, mode: FulfilmentMode): OrderStatus[] {
  return ALLOWED_TRANSITIONS[from].filter((status) => isStatusValidForMode(status, mode));
}

/**
 * A pickup order never ships, and a delivery order is never ready for pickup.
 * COLLECTED belongs to pickup alone and DELIVERED / IN_TRANSIT to delivery alone.
 *
 * Enforced rather than left to the UI. The board renders one action per card,
 * but the board is not the only caller, and a delivery order sitting in
 * READY_FOR_PICKUP would be invisible to the driver's lane.
 */
function isStatusValidForMode(status: OrderStatus, mode: FulfilmentMode): boolean {
  if (status === "READY_FOR_PICKUP" || status === "COLLECTED") return mode === "PICKUP";
  if (status === "SHIPPED" || status === "IN_TRANSIT" || status === "DELIVERED") return mode === "DELIVERY";
  return true;
}

/**
 * Validates a transition, throwing if it is not permitted.
 *
 * `ConflictError` (409) rather than a silent no-op, because the usual cause is
 * two staff members acting on the same order at once. The one who arrives
 * second needs to be told the state moved under them — a no-op would leave
 * them believing their action landed.
 */
export function assertTransition(context: TransitionContext): void {
  const { from, to, mode, paymentStatus, reason } = context;

  if (from === to) {
    throw new ConflictError(`This order is already ${from}.`);
  }

  if (isTerminalStatus(from)) {
    throw new ConflictError(`This order is ${from} and cannot change state.`);
  }

  if (!canTransition(from, to)) {
    throw new ConflictError(`An order cannot move from ${from} to ${to}.`);
  }

  if (!isStatusValidForMode(to, mode)) {
    throw new ConflictError(`${to} does not apply to a ${mode} order.`);
  }

  if (!paymentAllowsTransition(to, paymentStatus)) {
    throw new ConflictError("Payment has not been verified — verify the receipt before shipping.");
  }

  if (REASON_REQUIRED.includes(to) && !reason?.trim()) {
    throw new ConflictError(`Moving an order to ${to} requires a reason.`);
  }
}

/**
 * Whether leaving `from` for `to` must return the stock the order was holding.
 *
 * An order holds its decremented stock from placement until it completes. If
 * it is cancelled anywhere along the way, that stock has to go back — in the
 * same transaction, or the shop loses inventory to an order that never
 * happened.
 */
export function releasesStock(from: OrderStatus, to: OrderStatus): boolean {
  return STOCK_HOLDING_STATUSES.includes(from) && to === "CANCELLED";
}

/**
 * Whether a customer may still cancel, given how long ago the order was
 * placed.
 *
 * Enforced server-side. The storefront hides the button once the window
 * passes, but hiding a button is presentation, not enforcement — and the
 * window is configurable (`FulfilmentSettings.customerCancelWindowMinutes`),
 * so the two must not disagree.
 *
 * `cancelUntil` is the deadline snapshotted onto the order at placement
 * (`Order.customerCancelUntil`) — what the customer was promised. When the
 * order carries one it wins: the merchant widening or narrowing the window
 * afterwards must not change an order already placed. Orders placed before
 * the snapshot existed carry none and fall back to `placedAt` + the window.
 */
export function canCustomerCancel(status: OrderStatus, placedAt: Date, now: Date, windowMinutes: number, cancelUntil?: Date): boolean {
  // Once processing has started, cancelling costs the merchant real work.
  if (status !== "PLACED" && status !== "CONFIRMED") return false;

  if (cancelUntil) return now.getTime() <= cancelUntil.getTime();

  const elapsedMinutes = (now.getTime() - placedAt.getTime()) / 60_000;
  return elapsedMinutes <= windowMinutes;
}

/**
 * The payment status an order starts with.
 *
 * `NOT_REQUIRED` is COD's resting state — there is genuinely nothing to await
 * until handover, so reusing a pending state would leave every COD order
 * looking unpaid forever. `AWAITING_PAYMENT` covers any method that needs
 * either a manually-verified proof or a provider confirmation before it
 * counts as paid (D-8: no payment gateway integration exists yet, so only
 * the proof path is reachable today — the provider path is the same state,
 * reached the same way, once one exists). Which methods need proof or a
 * provider is configuration (`PaymentSettings.methods[]`), not a fact this
 * engine hardcodes — the caller resolves that and passes the booleans.
 */
export function initialPaymentStatus(requiresProof: boolean, requiresProviderIntegration = false): PaymentStatus {
  return requiresProof || requiresProviderIntegration ? "AWAITING_PAYMENT" : "NOT_REQUIRED";
}

const ALLOWED_PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  NOT_REQUIRED: ["VERIFIED", "REFUNDED"],
  AWAITING_PAYMENT: ["SUBMITTED"],
  SUBMITTED: ["VERIFIED", "REJECTED"],
  // Rejection is never a dead end: the customer uploads new proof (or a provider retries) and tries again.
  REJECTED: ["AWAITING_PAYMENT", "SUBMITTED"],
  VERIFIED: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_PAYMENT_TRANSITIONS[from].includes(to);
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus, reason?: string): void {
  if (from === to) {
    throw new ConflictError(`Payment is already ${from}.`);
  }

  if (!canTransitionPayment(from, to)) {
    throw new ConflictError(`Payment cannot move from ${from} to ${to}.`);
  }

  // The customer is shown this verbatim and needs to know what to fix.
  if (to === "REJECTED" && !reason?.trim()) {
    throw new ConflictError("Rejecting a payment requires a reason.");
  }
}

/**
 * The `Order.timeline[]` event a fulfilment-status transition corresponds
 * to. `undefined` for a transition with no dedicated event — `PLACED` is
 * covered separately by `order-placement`'s own initial entry, and there is
 * no `to`-state this map fails to cover among `ALLOWED_TRANSITIONS`' actual
 * targets, so `undefined` here would indicate a real gap if it were ever hit.
 */
export function timelineEventForStatus(status: OrderStatus): OrderTimelineEventType {
  const map: Record<OrderStatus, OrderTimelineEventType> = {
    PLACED: "ORDER_PLACED",
    CONFIRMED: "ORDER_CONFIRMED",
    PROCESSING: "ORDER_PROCESSING",
    READY_FOR_PICKUP: "ORDER_READY_FOR_PICKUP",
    SHIPPED: "ORDER_SHIPPED",
    IN_TRANSIT: "ORDER_IN_TRANSIT",
    DELIVERED: "ORDER_DELIVERED",
    COLLECTED: "ORDER_COLLECTED",
    CANCELLED: "ORDER_CANCELLED",
  };
  return map[status];
}

/** The `Order.timeline[]` event a payment-status transition corresponds to. `NOT_REQUIRED` has none — nothing happened, it is the resting state. */
export function timelineEventForPaymentStatus(status: PaymentStatus): OrderTimelineEventType | undefined {
  const map: Partial<Record<PaymentStatus, OrderTimelineEventType>> = {
    SUBMITTED: "PAYMENT_SUBMITTED",
    VERIFIED: "PAYMENT_VERIFIED",
    REJECTED: "PAYMENT_REJECTED",
    REFUNDED: "PAYMENT_REFUNDED",
  };
  return map[status];
}
