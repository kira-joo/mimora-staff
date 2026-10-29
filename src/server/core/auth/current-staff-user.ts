import "../ensure-configured";
import { verifyAuthToken } from "@kira-joo/backend-toolkit-next";
import type { AuthUser } from "@kira-joo/backend-toolkit-core";
import { cookies } from "next/headers";
import { cache } from "react";
import { STAFF_SESSION_COOKIE } from "./staff-auth.constants";
import { resolveStaffUser } from "./resolve-staff-user";

/**
 * The signed-in staff member for a Server Component, or null.
 *
 * For the shell and navigation only — never authorization. Every byte of
 * staff data is fetched from `/api/admin/**`, which authenticates and checks
 * permissions on each request. Memoized per request (`cache`), so the
 * layout and a page share one lookup. Mirrors the API's own guard: the token must
 * verify, the account must be active, and its `tokenVersion` must match, so
 * a token minted before a role change or deactivation does not render a shell
 * the API would refuse. Never throws.
 */
export const getCurrentStaffUser = cache(async function getCurrentStaffUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const payload = await verifyAuthToken(token);
    if (!payload.sub) return null;
    const user = await resolveStaffUser(String(payload.sub));
    if (!user || user.tokenVersion !== payload.tokenVersion) return null;
    return user;
  } catch {
    return null;
  }
});
