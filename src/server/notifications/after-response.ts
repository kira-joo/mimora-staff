import { after } from "next/server";

/**
 * Work that must happen, but must not hold the HTTP response open — an SMTP
 * round trip is the case: a slow or unreachable mail server must never add its
 * latency to "place order".
 *
 * **In a request scope** (a route handler or server action) the task is handed to
 * Next's `after()`, which runs it once the response has been sent and keeps a
 * serverless invocation alive until it settles.
 *
 * **Outside one** (a script, a test, a scheduler calling a use case directly)
 * `after()` throws, so the task runs as a plain non-blocking promise instead. It is
 * tracked, so a caller that genuinely needs it finished — a test — can
 * `await settleBackgroundWork()`; no production path does.
 *
 * Either way the task's failure is logged by NAME (a message can quote a
 * recipient or a connection string) and never propagates: this is the
 * "no flow may depend on delivery" rule, enforced at the one place that
 * dispatches.
 */
const pending = new Set<Promise<void>>();

export function runAfterResponse(label: string, task: () => Promise<void>): void {
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[notifications] ${label} failed: ${error instanceof Error ? error.name : "unknown error"}`);
    }
  };

  try {
    after(guarded);
    return;
  } catch {
    // Not in a request scope: fall through to the non-blocking promise below.
  }

  const running = guarded();
  pending.add(running);
  void running.finally(() => pending.delete(running));
}

/** Resolves once every non-request-scope background task has finished. For tests and scripts; never call it on a request path. */
export async function settleBackgroundWork(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}
