import type { BoardCard, OrderStatus } from "src/api/orders.endpoints";
import { nextStatuses, paymentAllowsTransition } from "src/server/engines/order-state/order-state-machine";

type Advance = Exclude<OrderStatus, "PLACED" | "CANCELLED">;

/**
 * The forward steps one tap can take from a card — cancelling is never one tap (it needs a reason, so it lives on the
 * order). Which steps exist comes from the order state machine itself, the engine the API enforces with, so the board
 * never offers a move the server would refuse. `blocked` is the payment rule: shown disabled with its reason, not hidden.
 */
export function advanceStepsFor(card: Pick<BoardCard, "status" | "mode" | "paymentStatus">): Array<{ to: Advance; blocked: boolean }> {
  return nextStatuses(card.status, card.mode)
    .filter((to): to is Advance => to !== "CANCELLED" && to !== "PLACED")
    .map((to) => ({ to, blocked: !paymentAllowsTransition(to, card.paymentStatus) }));
}

/** The label on the one-tap button: what happens, in the imperative. */
export const ADVANCE_LABEL: Record<Advance, string> = {
  CONFIRMED: "Confirm",
  PROCESSING: "Start processing",
  READY_FOR_PICKUP: "Ready for pickup",
  SHIPPED: "Mark shipped",
  IN_TRANSIT: "In transit",
  DELIVERED: "Mark delivered",
  COLLECTED: "Mark collected",
};

/** How long an order has been waiting, glanceable: "12 min", "3 h", "2 d". Never negative (a clock skewed ahead reads "just now"). */
export function waitingLabel(placedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(placedAt).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** Waiting a day or more is the one signal the board raises on its own; everything else is ordered by age already. */
export function isOverdue(placedAt: string, now: number): boolean {
  return now - new Date(placedAt).getTime() >= 24 * 60 * 60_000;
}
