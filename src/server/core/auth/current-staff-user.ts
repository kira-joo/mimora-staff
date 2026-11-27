import "../ensure-configured";
import { verifyAuthToken } from "@kira-joo/backend-toolkit-next";
import type { AuthUser } from "@kira-joo/backend-toolkit-core";
import { cookies } from "next/headers";
import { cache } from "react";
import { STAFF_SESSION_COOKIE } from "./staff-auth.constants";
import { resolveStaffUser } from "./resolve-staff-user";
import { connectToDatabase } from "../db/connect";

/**
 * The signed-in staff member for a Server Component, or null.
 *
 * For the shell and navigation only — never authorization. Every byte of
 * staff data is fetched from `/api/admin/**`, which authenticates and checks
 * permissions on each request. Memoized per request (`cache`), so the
 * layout and a page share one lookup. Mirrors the API's own guard: the token must
 * verify, the account must be active, and its `tokenVersion` must match, so
 * a token minted before a role change or deactivation does not render a shell
 * the API would refuse. Returns null for any session problem; throws only when
 * the database itself is not ready (see the guard below).
 */
export const getCurrentStaffUser = cache(async function getCurrentStaffUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  if (!token) return null;

  let subject: string;
  let tokenVersion: unknown;
  try {
    const payload = await verifyAuthToken(token);
    if (!payload.sub) return null;
    subject = String(payload.sub);
    tokenVersion = payload.tokenVersion;
  } catch {
    return null;
  }

  /*
   * The same readiness guard every `/api/admin/**` route runs before its handler (store identity, then indexes —
   * `connect.ts`). Server-rendered pages read the database through this function and nothing else, and a failed boot
   * no longer stops them rendering (`instrumentation.ts`), so the guard must hold here too. Deliberately OUTSIDE the
   * catch: a database that is unreachable or not this store's is an error page, never a quiet "not signed in" — that
   * would send staff to the sign-in screen for a fault no password can fix. It retries on the next request.
   */
  await connectToDatabase();

  try {
    const user = await resolveStaffUser(subject);
    if (!user || user.tokenVersion !== tokenVersion) return null;
    return user;
  } catch {
    return null;
  }
});
