import { SortOrder } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { orderRepository, paymentSettingsRepository } from "../../core/repositories";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { releaseOrderStock } from "../../commerce/release-order-stock";
import { activeWindowMinutes, unpaidExpiryCutoff } from "../../engines/order-state/unpaid-expiry";
import { assertTransition, releasesStock } from "../../engines/order-state/order-state-machine";
import type { OrderStatus } from "../../engines/order-state/order-state.types";

/**
 * Only orders no one has started work on are swept. A PROCESSING order has a human behind it (picked, being packed);
 * cancelling it from a timer would throw that work away, so it is left for staff — the payments queue and the order
 * board already show it as unpaid.
 */
const SWEEPABLE_STATUSES: readonly OrderStatus[] = ["PLACED", "CONFIRMED"];

/** One sweep never handles more than this many orders per payment method; the next run picks up the rest. */
const BATCH_PER_METHOD = 200;

export interface ExpireUnpaidOrdersResult {
  /** Order numbers cancelled by this run. */
  cancelled: string[];
  /** Orders that stopped being eligible between being read and being cancelled (the customer submitted a proof, or staff moved the order) — left untouched. */
  skipped: number;
  /** Orders whose cancellation failed and rolled back; the next run retries them. */
  failed: Array<{ orderNumber: string; message: string }>;
  /** The methods that have an `autoCancelMinutes` configured. Empty means the clock is off for every method. */
  methodsSwept: string[];
}

/**
 * Cancels orders still awaiting payment (`payment.status === AWAITING_PAYMENT`) once they are older than their
 * method's `autoCancelMinutes` (`PaymentSettings.methods[]`). A method with no value configured is never touched.
 *
 * - **Each cancellation is its own transaction** — status, timeline entry (actor SYSTEM, with the reason) and the
 *   stock release (the existing `releaseStock`, through `releaseOrderStock`) commit together or not at all, and one
 *   order's failure rolls back only that order.
 * - **Idempotent.** A cancelled order no longer matches, so a re-run (or two overlapping runs) never cancels or
 *   releases stock twice; the write itself is guarded on `status` + `payment.status`, so an order whose proof
 *   arrives mid-sweep is skipped, not cancelled.
 * - **`now` is a parameter**, so the boundary is testable and a sweep is reproducible.
 *
 * Called by `POST /api/admin/orders/expire-unpaid` (a staff action) and `POST /api/internal/jobs/expire-unpaid-orders`
 * (a scheduler). The expiry never refunds anything: an order awaiting payment has no money to return.
 */
export async function expireUnpaidOrders(now: Date): Promise<ExpireUnpaidOrdersResult> {
  const result: ExpireUnpaidOrdersResult = { cancelled: [], skipped: 0, failed: [], methodsSwept: [] };

  const settings = await paymentSettingsRepository.findOne({ where: {}, skipThrowError: true });
  for (const method of settings?.methods ?? []) {
    const minutes = activeWindowMinutes(method.autoCancelMinutes);
    if (minutes === undefined) continue;
    result.methodsSwept.push(method.method);

    const expired = await orderRepository.findAll({
      where: {
        "payment.method": method.method,
        "payment.status": "AWAITING_PAYMENT",
        status: { $in: [...SWEEPABLE_STATUSES] },
        placedAt: { $lt: unpaidExpiryCutoff(now, minutes) },
      },
      sort: { field: "placedAt", order: SortOrder.ASC },
      take: BATCH_PER_METHOD,
    });

    for (const order of expired) {
      const reason = `Not paid within ${minutes} minutes — cancelled automatically.`;
      try {
        const outcome = await withTransaction(async (tx) => {
          assertTransition({ from: order.status, to: "CANCELLED", mode: order.fulfilment.mode, paymentStatus: "AWAITING_PAYMENT", reason });

          const cancelled = await orderRepository.updateAtomic(
            { _id: order._id, status: order.status, "payment.status": "AWAITING_PAYMENT" },
            { $set: { status: "CANCELLED" } },
            { skipThrowError: true }
          );
          // Nothing matched: the order moved under us (a proof arrived, staff acted, another sweep got there first).
          // Nothing changed, but the toolkit counts the attempted write, so the transaction is still completed.
          if (!cancelled) return tx.complete("skipped" as const);

          await appendOrderTimelineEntry(order._id, {
            type: "ORDER_CANCELLED",
            at: now,
            actorType: "SYSTEM",
            reason,
            metadata: { automatic: true, method: method.method, autoCancelMinutes: minutes },
          });

          if (releasesStock(order.status, "CANCELLED")) {
            await releaseOrderStock(order._id, { at: now });
          }

          return tx.complete("cancelled" as const);
        });

        if (outcome === "cancelled") result.cancelled.push(order.orderNumber);
        else result.skipped += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[expire-unpaid] could not cancel ${order.orderNumber}: ${message}`);
        result.failed.push({ orderNumber: order.orderNumber, message });
      }
    }
  }

  return result;
}
