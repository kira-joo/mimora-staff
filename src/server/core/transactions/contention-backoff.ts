/**
 * Backoff between attempts of a contended transaction.
 *
 * `withTransaction` (backend-toolkit-mongoose) retries a write conflict, but
 * the driver re-runs the callback IMMEDIATELY. Under real contention the
 * winner's transaction is usually still open at that instant, so the loser
 * conflicts again, and its whole budget (4 attempts by default) burns in a few
 * milliseconds — measured 2026-10-21 as a `ServiceUnavailableError` (503) for
 * 2 of 15 runs of three concurrent orders. Order placement always writes at
 * least one store-wide document (the order-number sequence), so any burst of
 * orders contends, not only orders of one product.
 *
 * The cure is the standard one: full-jitter exponential backoff, awaited at the
 * START of a retried attempt — before its first operation, so the new attempt
 * holds nothing while it waits — plus a budget sized for a burst.
 *
 * Correctness is unchanged: every attempt still re-reads and re-checks
 * everything inside one transaction, and the stock predicate stays in the
 * update filter. This only stops a loser from giving up while a winner is
 * still committing. (A toolkit-level backoff would serve every caller; it is a
 * package change and is not made here.)
 */
export const CONTENDED_MAX_RETRIES = 8;

const BASE_DELAY_MS = 20;
const MAX_DELAY_MS = 500;

/** Full jitter: uniform in [0, min(cap, base·2^(attempt-2))]. Attempt 1 never waits. */
export function contentionDelayMs(attempt: number, random: () => number = Math.random): number {
  if (attempt <= 1) return 0;
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 2));
  return Math.round(random() * ceiling);
}

export async function backOffBeforeRetry(attempt: number): Promise<void> {
  const delay = contentionDelayMs(attempt);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
