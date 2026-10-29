import { readTokenCookie } from "@kira-joo/backend-toolkit-next";
import { logoutCustomer } from "src/server/shop/auth/logout";
import { CUSTOMER_REFRESH_COOKIE } from "src/server/core/auth/customer-session-cookies";
import { createPostRoute } from "src/server/core/route-factories";

/**
 * `auth: false` — logout must succeed even when the access token is
 * already expired or missing entirely, so there is no actor to resolve.
 * Exempted in `shop-route-coverage.test.ts`'s `NO_ACTOR_EXEMPT`.
 *
 * No idempotency wiring: see `logout.ts`'s own doc comment —
 * `revokeToken`'s underlying `revokeFamily` is already a no-op on an
 * already-revoked family, and re-clearing cleared cookies is harmless.
 * Always `204`, whether or not a refresh cookie was present at all — a
 * logout attempt with no session to end is not an error.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 204,
  handler: async ({ request }) => {
    const presentedToken = readTokenCookie(request, CUSTOMER_REFRESH_COOKIE);
    await logoutCustomer(presentedToken);
    return undefined;
  },
});
