import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Authentication for scheduler-triggered jobs (`/api/internal/jobs/**`).
 *
 * A scheduler (Vercel Cron, a Kubernetes CronJob, a plain `curl` in cron) has no staff session, so those routes
 * declare `auth: false` — which, per the repo's own rule, means the handler MUST authenticate. The credential is a
 * shared secret in `JOBS_SECRET` or `CRON_SECRET`, presented as the `x-jobs-secret` header or as
 * `Authorization: Bearer <secret>`.
 *
 * **Why two names for one audience.** Vercel Cron sends `Authorization: Bearer $CRON_SECRET` whenever a project
 * defines `CRON_SECRET`, and that name is not ours to choose. Requiring the operator to also set `JOBS_SECRET` to the
 * same value would be a silent-mismatch trap (a 404 forever, indistinguishable from "jobs OFF"), so the guard accepts
 * either: on Vercel set `CRON_SECRET` only; anywhere else set `JOBS_SECRET` and send `x-jobs-secret`. Both belong to
 * the one jobs audience; neither is shared with any auth or revalidation secret.
 *
 * - **Constant-time compare**, over SHA-256 digests so both sides are always 32 bytes: no early exit on the first
 *   differing byte, and no length leak.
 * - **404, never 401/403**, for a missing or wrong secret — and when no secret is configured at all. The route does
 *   not announce that it exists to anyone who cannot call it.
 * - **Never a default.** With `JOBS_SECRET` unset every call is a 404: the capability is OFF, and OFF is announced
 *   once at boot (`jobsSecretStatus`, wired into `instrumentation.ts`), because a route that silently answers 404
 *   forever looks exactly like a scheduler that is working.
 * - Distinct from every other secret here (`REVALIDATE_SECRET`, the auth secrets): two audiences never share one.
 */
export const JOBS_SECRET_HEADER = "x-jobs-secret";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** The presented secret, from either accepted header, or `undefined`. */
function presentedSecret(request: NextRequest): string | undefined {
  const direct = request.headers.get(JOBS_SECRET_HEADER);
  if (direct) return direct;
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

/** Pure check, for tests and for the guard below. `false` for an unset/empty expected secret, whatever was presented. */
export function jobsSecretMatches(expected: string | undefined, presented: string | undefined): boolean {
  if (!expected || !presented) return false;
  return timingSafeEqual(digest(expected), digest(presented));
}

/** Names of the variables that may hold the jobs credential. */
export const JOBS_SECRET_VARIABLES = ["JOBS_SECRET", "CRON_SECRET"] as const;

/** Throws a 404 unless the request carries the configured `JOBS_SECRET` or `CRON_SECRET`. */
export function requireJobsSecret(request: NextRequest, env: Record<string, string | undefined> = process.env): void {
  const presented = presentedSecret(request);
  // Every configured secret is compared (no early exit on the first hit) so timing does not say which one matched.
  const matches = JOBS_SECRET_VARIABLES.map((name) => jobsSecretMatches(env[name], presented));
  if (!matches.some(Boolean)) throw new NotFoundError("Not found.");
}

export interface JobsConfigStatus {
  state: "configured" | "unconfigured";
  /** Safe to log: names the variable, never its value. */
  message: string;
}

/** Classifies the variables that switch scheduled jobs on. Called at boot from `instrumentation.ts`. */
export function jobsSecretStatus(env: Record<string, string | undefined>): JobsConfigStatus {
  if (!env.JOBS_SECRET && !env.CRON_SECRET) {
    return {
      state: "unconfigured",
      message:
        "JOBS_SECRET is not set (nor CRON_SECRET) — scheduled jobs OFF. GET and POST /api/internal/jobs/* answer 404 to every caller, so unpaid orders " +
        "are NOT auto-cancelled on a schedule (staff can still run the sweep from the console) and abandoned image uploads are NOT swept.",
    };
  }
  return { state: "configured", message: "scheduled jobs are configured." };
}
