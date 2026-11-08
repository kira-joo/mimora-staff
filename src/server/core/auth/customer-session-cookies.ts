import { eraseTokenCookie, writeTokenCookie } from "@kira-joo/backend-toolkit-next";

/**
 * Customer cookie identifiers — wholly independent names from the staff
 * surface (`STAFF_SESSION_COOKIE` in `toolkit.config.ts`); two audiences
 * never share a cookie name (this repo's own non-negotiable #9).
 *
 * **Three cookies, not two, matching the established shop-auth design:**
 *
 * - `store_customer_session` — the short-lived access token. `httpOnly`,
 *   path `/`, lifetime matches `CUSTOMER_ACCESS_TOKEN_TTL`
 *   (`customer-jwt-config.ts`'s default `15m`).
 * - `store_customer_refresh` — the rotating refresh token. `httpOnly`,
 *   scoped to the auth route prefix that actually needs it
 *   (`/api/shop/auth`) — **the routes live beneath the prefix, not the
 *   other way around** (restaurant-platform-staff's own documented fix:
 *   widening a refresh cookie to `/` so a sibling route could reach it is
 *   the wrong trade, and a *different* sibling app shipped exactly that
 *   mistake — "signing out revoked nothing while returning 200"). Every
 *   route that needs this cookie (`refresh`, `logout`) lives under
 *   `/api/shop/auth/`, so the narrow path costs nothing.
 * - `store_customer_marker` — **not** `httpOnly`. Carries no token at
 *   all, just a presence flag (`"1"`), so a client (the storefront's own
 *   proxy layer, or client-side UI) can cheaply know "a session likely
 *   exists" without reading the actual credential — which it cannot, by
 *   design (`httpOnly`) — and without an extra network round trip on every
 *   page load. Its lifetime matches the REFRESH token's, not the access
 *   token's: its job is "is there a session worth trying to refresh",
 *   which outlives any single access token.
 *
 * This does not change what the workspace's authentication non-negotiable
 * already requires: **frontend JavaScript never reads, stores, refreshes,
 * or attaches the actual token.** The marker's value is not a credential —
 * it is a boolean-shaped hint, readable specifically because it carries
 * nothing sensitive.
 */
export const CUSTOMER_SESSION_COOKIE = "store_customer_session";
export const CUSTOMER_REFRESH_COOKIE = "store_customer_refresh";
export const CUSTOMER_MARKER_COOKIE = "store_customer_marker";

/** Every route that reads/writes the refresh cookie lives under this prefix — see the module doc comment. */
export const CUSTOMER_REFRESH_COOKIE_PATH = "/api/shop/auth";

export interface CustomerSessionCookieValues {
  accessToken: string;
  accessTokenTtlSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
}

/** Writes all three cookies from inside a route-factory handler (no raw `NextResponse` available — see `writeTokenCookie`'s own doc comment for why this is the only mechanism that works there). */
export async function writeCustomerSessionCookies(values: CustomerSessionCookieValues): Promise<void> {
  await writeTokenCookie(values.accessToken, { name: CUSTOMER_SESSION_COOKIE, path: "/", maxAge: values.accessTokenTtlSeconds });
  await writeTokenCookie(values.refreshToken, {
    name: CUSTOMER_REFRESH_COOKIE,
    path: CUSTOMER_REFRESH_COOKIE_PATH,
    maxAge: values.refreshTokenTtlSeconds,
  });
  await writeTokenCookie("1", { name: CUSTOMER_MARKER_COOKIE, httpOnly: false, path: "/", maxAge: values.refreshTokenTtlSeconds });
}

/** Clears all three cookies from inside a route-factory handler. Re-sends the same `path` each cookie was set with — a mismatch leaves the cookie in place and the customer appears logged out while staying authenticated (the exact restaurant-precedent bug this design is built to avoid). */
export async function clearCustomerSessionCookies(): Promise<void> {
  await eraseTokenCookie({ name: CUSTOMER_SESSION_COOKIE, path: "/" });
  await eraseTokenCookie({ name: CUSTOMER_REFRESH_COOKIE, path: CUSTOMER_REFRESH_COOKIE_PATH });
  await eraseTokenCookie({ name: CUSTOMER_MARKER_COOKIE, httpOnly: false, path: "/" });
}
