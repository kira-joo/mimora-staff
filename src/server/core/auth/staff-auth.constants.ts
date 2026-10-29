/**
 * Staff session lifetimes and cookie identifiers — one source for both the
 * token and the cookie that carries it, so the two cannot disagree.
 *
 * Cookie names are the Phase 0 identifiers (`docs/store/phases/00-identifiers.md`
 * §4). The refresh cookie is scoped to a path prefix and every route that
 * needs it — refresh, logout — lives beneath that prefix; the cookie is never
 * widened to `/` so a sibling route can reach it.
 */
export const STAFF_SESSION_COOKIE = "store_staff_session";
export const STAFF_REFRESH_COOKIE = "store_staff_refresh";
export const STAFF_REFRESH_COOKIE_PATH = "/api/admin/auth/token";

export const STAFF_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** Matches `restaurant-platform-staff`, the reference staff implementation. */
export const STAFF_REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** How long an invited staff member has to activate before an administrator must re-invite them. */
export const STAFF_INVITE_TOKEN_TTL_MS = 60 * 60 * 1000;
