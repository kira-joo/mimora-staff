import type { ExpireUnpaidOrdersResult } from "src/api/orders.endpoints";

/**
 * What to tell staff after a sweep. The sweep being OFF (no payment method has an auto-cancel time) is said plainly —
 * "0 cancelled" alone would read as "nothing was overdue", which is a different fact.
 */
export function expireUnpaidSummary(result: ExpireUnpaidOrdersResult): { tone: "success" | "warning"; message: string } {
  if (result.methodsSwept.length === 0) {
    return { tone: "warning", message: "No payment method has an auto-cancel time set, so nothing was checked. Set one in Settings → Payments." };
  }
  const count = result.cancelled.length;
  const failed = result.failed.length;
  const base = count === 0 ? "No unpaid orders were past their deadline." : `Cancelled ${count} unpaid order${count === 1 ? "" : "s"}.`;
  if (failed > 0) return { tone: "warning", message: `${base} ${failed} could not be cancelled — try again.` };
  return { tone: "success", message: base };
}
