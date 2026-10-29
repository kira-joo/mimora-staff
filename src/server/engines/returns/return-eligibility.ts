import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { OrderTimelineEntry } from "../../commerce/order.schema";
import { isCompletedStatus } from "../order-state/order-state-machine";
import type { OrderStatus } from "../order-state/order-state.types";
import type {
  OrderLineReturnState,
  QuantityValidation,
  ReturnDisposition,
  ReturnEligibilityResult,
  ReturnLineQuantityCheck,
  ReturnStatus,
} from "./returns.types";

/**
 * Finds when an order became `DELIVERED` (or, for pickup, `COLLECTED`), from its timeline.
 *
 * **Phase 4A.5 closes the gap `checkReturnEligibility`'s own doc comment
 * used to disclose**: `Order.timeline[]` did not exist at all, so
 * `deliveredAt` had to be supplied by the caller from some other source. It
 * now exists — this is the derivation that was previously impossible.
 * Still returns `undefined` rather than throwing when no `ORDER_DELIVERED`
 * entry is present (an order that was never delivered, or one placed before
 * this phase shipped) — the caller decides what an absent instant means,
 * same as before.
 */
export function findDeliveredAt(timeline: OrderTimelineEntry[]): Date | undefined {
  // Read from the end: a delivered order cannot be re-delivered per the
  // fulfilment state machine, so the last (only) match is authoritative.
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const type = timeline[index]!.type;
    if (type === "ORDER_DELIVERED" || type === "ORDER_COLLECTED") return timeline[index]!.at;
  }
  return undefined;
}

/**
 * Whether an order is within its return window right now.
 *
 * `deliveredAt` stays a plain parameter, not something this function reads
 * off an `Order` itself — it remains pure and testable independent of how
 * the caller sourced the date (`findDeliveredAt` above, or otherwise).
 *
 * Only a completed order — `DELIVERED`, or `COLLECTED` for pickup — can be
 * returned: a cancelled order was never fulfilled, and every other status is
 * still in flight. The window starts at the completion instant either way.
 */
export function checkReturnEligibility(
  orderStatus: OrderStatus,
  deliveredAt: Date,
  now: Date,
  returnWindowDays: number
): ReturnEligibilityResult {
  if (!isCompletedStatus(orderStatus)) {
    return { eligible: false, reason: "NOT_DELIVERED" };
  }

  const elapsedDays = (now.getTime() - deliveredAt.getTime()) / (24 * 60 * 60 * 1000);
  if (elapsedDays > returnWindowDays) {
    return { eligible: false, reason: "WINDOW_EXPIRED" };
  }

  return { eligible: true };
}

/**
 * Validates every requested return line's quantity against what was actually
 * ordered, minus whatever has already been returned against it. A return is
 * partial-line-aware: two separate return requests against the same order
 * line must never together exceed the quantity originally purchased.
 */
export function validateReturnQuantities(
  requested: ReturnLineQuantityCheck[],
  orderLines: OrderLineReturnState[]
): QuantityValidation[] {
  const orderLineById = new Map(orderLines.map((line) => [line.orderLineId, line]));

  return requested.map((request): QuantityValidation => {
    if (request.requestedQuantity < 1) {
      return { valid: false, orderLineId: request.orderLineId, reason: "NOT_POSITIVE" };
    }

    const orderLine = orderLineById.get(request.orderLineId);
    if (!orderLine) {
      return { valid: false, orderLineId: request.orderLineId, reason: "LINE_NOT_FOUND" };
    }

    const remaining = orderLine.orderedQuantity - orderLine.alreadyReturnedQuantity;
    if (request.requestedQuantity > remaining) {
      return { valid: false, orderLineId: request.orderLineId, reason: "EXCEEDS_REMAINING" };
    }

    return { valid: true };
  });
}

const ALLOWED_RETURN_TRANSITIONS: Readonly<Record<ReturnStatus, readonly ReturnStatus[]>> = {
  REQUESTED: ["APPROVED", "REJECTED"],
  // APPROVED → REFUNDED is deliberate and kept (the console documents it): staff may record a refund without
  // waiting for the goods — lost in transit, or the customer keeps a low-value item. It is the one path that
  // refunds a return whose goods were never received, and it forecloses receiving them afterwards
  // (receive requires APPROVED). The normal path is APPROVED → RECEIVED → REFUNDED.
  APPROVED: ["RECEIVED", "REFUNDED"],
  RECEIVED: ["REFUNDED"],
  REJECTED: [],
  REFUNDED: [],
};

const REASON_REQUIRED: readonly ReturnStatus[] = ["REJECTED"];

export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return ALLOWED_RETURN_TRANSITIONS[from].includes(to);
}

/**
 * Per D-12, this system records and audits a refund; it does not execute
 * one. `REFUNDED` is reachable from `RECEIVED` (goods inspected) and from
 * `APPROVED` (refund without waiting for goods — see the map above) — a
 * return that was never approved has nothing to refund, and a rejected one
 * is a dead end by design (unlike a rejected payment proof, a rejected return
 * is a staff decision about the goods, not a retriable customer error).
 * `RECEIVED` is reached only by receiving every line, never by a staff click
 * of its own.
 */
export function assertReturnTransition(from: ReturnStatus, to: ReturnStatus, reason?: string): void {
  if (from === to) {
    throw new ConflictError(`This return is already ${from}.`);
  }

  if (!canTransitionReturn(from, to)) {
    throw new ConflictError(`A return cannot move from ${from} to ${to}.`);
  }

  if (REASON_REQUIRED.includes(to) && !reason?.trim()) {
    throw new ConflictError(`Moving a return to ${to} requires a reason.`);
  }
}

/**
 * The customer-facing reading of a return's status. `RECEIVED` is an internal
 * warehouse step — to the customer the return is still approved and awaiting
 * its refund — so the storefront's status vocabulary does not grow a value it
 * has never heard of.
 */
export function customerReturnStatus(status: ReturnStatus): Exclude<ReturnStatus, "RECEIVED"> {
  return status === "RECEIVED" ? "APPROVED" : status;
}

/** Whether `assertInspectedCondition` is satisfied — the inspected condition is mandatory when a line is received. */
export function assertInspectedCondition(inspectedCondition: string | undefined): void {
  if (!inspectedCondition?.trim()) {
    throw new ConflictError("Receiving a return line requires the inspected condition.");
  }
}

/** Every line has been received (carries a disposition) — the return as a whole is then `RECEIVED`. */
export function allLinesReceived(lines: ReadonlyArray<{ disposition?: ReturnDisposition }>): boolean {
  return lines.length > 0 && lines.every((line) => line.disposition !== undefined);
}

/** `refundReference` is mandatory once a refund is recorded — D-12: no pretence of automation, always a human-supplied reference. */
export function assertRefundReference(refundReference: string | undefined): void {
  if (!refundReference?.trim()) {
    throw new ConflictError("Recording a refund requires a reference.");
  }
}

export type { ReturnDisposition };
