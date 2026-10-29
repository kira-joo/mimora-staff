/**
 * Tells the storefront that tagged content has changed.
 *
 * Best-effort by design: the route factory catches and logs any rejection,
 * so a failed invalidation never turns a successful write into a failed
 * response. An operator whose price edit saved but whose cache lagged by a
 * minute is a much better outcome than a save that reports failure when it
 * actually succeeded.
 *
 * ## Unconfigured is a no-op, and it says so — once
 *
 * Running the backoffice without the storefront is normal in local
 * development, so this cannot throw. But the silent version of that is
 * exactly how this mechanism stays broken in production: a route can
 * declare `revalidateTags`, return 200, and invalidate nothing, forever,
 * with zero signal — `backend-toolkit-next`'s own `runRevalidation` returns
 * early with no warning when `cache` is unconfigured. So the state is
 * announced once per process instead of never, distinguishing **fully
 * unconfigured** (both env vars unset — expected locally) from
 * **half-configured** (one set, one missing — a typo, not a choice, and it
 * looks identical to working from the outside).
 */
let announced = false;

export type RevalidationConfigStatus = {
  state: "configured" | "unconfigured" | `half-configured:${string}`;
  /** Human-readable, safe to log: names variables, never their values. */
  message: string;
};

/**
 * Pure classification of the two env vars that make cache invalidation work.
 * Called at boot from `instrumentation.ts` so a capability configured OFF is
 * announced at startup rather than on the first tagged mutation.
 */
export function revalidationConfigStatus(
  env: Record<string, string | undefined>
): RevalidationConfigStatus {
  const url = env.STOREFRONT_REVALIDATE_URL;
  const secret = env.REVALIDATE_SECRET;

  if (!url && !secret) {
    return {
      state: "unconfigured",
      message:
        "STOREFRONT_REVALIDATE_URL and REVALIDATE_SECRET are unset, so cache invalidation is disabled. " +
        "Content changes will NOT reach the storefront until it is rebuilt.",
    };
  }
  if (!url || !secret) {
    const missing = url ? "REVALIDATE_SECRET" : "STOREFRONT_REVALIDATE_URL";
    return {
      state: `half-configured:${missing}`,
      message: `revalidation is half-configured — ${missing} is missing. Nothing is being published.`,
    };
  }
  return { state: "configured", message: "cache invalidation is configured." };
}

function announceOnce(message: string): void {
  if (announced) return;
  announced = true;
  console.warn(`[revalidation] ${message}`);
}

/** Origin + path only: query strings can carry credentials, the secret never belongs in an error. */
function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "<invalid STOREFRONT_REVALIDATE_URL>";
  }
}

export async function publishRevalidation(tags: string[]): Promise<void> {
  const status = revalidationConfigStatus(process.env);
  if (status.state !== "configured") {
    announceOnce(status.message);
    return;
  }
  const url = process.env.STOREFRONT_REVALIDATE_URL!;
  const secret = process.env.REVALIDATE_SECRET!;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Revalidate-Secret": secret },
    body: JSON.stringify({ tags }),
    // The write has already committed; waiting on a cache hint must not hold
    // the response open.
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    const hint =
      response.status === 404
        ? " 404 from the storefront's receiver means REVALIDATE_SECRET differs between the two apps, " +
          "or STOREFRONT_REVALIDATE_URL points at the wrong route."
        : "";
    throw new Error(`Revalidation failed with ${response.status} (POST ${describeTarget(url)}).${hint}`);
  }
}
