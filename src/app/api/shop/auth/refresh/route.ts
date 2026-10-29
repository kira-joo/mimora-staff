import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { readTokenCookie } from "@kira-joo/backend-toolkit-next";
import { refreshCustomerSession } from "src/server/shop/auth/refresh";
import { hashVerificationToken } from "src/server/shop/auth/hash-verification-token";
import { CUSTOMER_REFRESH_COOKIE } from "src/server/core/auth/customer-session-cookies";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import { createPostRoute } from "src/server/core/route-factories";

const ROUTE = "POST /api/shop/auth/refresh";

/**
 * `auth: false` — the customer's ACCESS token may already be expired (that
 * is the whole reason this route exists), so there is no resolvable
 * `resolveShopActor()` identity here, only a refresh cookie read directly
 * off the request. Exempted in `shop-route-coverage.test.ts`'s
 * `NO_ACTOR_EXEMPT`.
 *
 * Idempotency is scoped by a hash of the PRESENTED refresh token, not a
 * resolved customer id — the whole point of `rotateRefreshToken` is that
 * the subject isn't known until after it succeeds, and that is exactly
 * what a client retry (dropped response, same token presented twice) must
 * not be allowed to trip: without this claim, a retry would look
 * indistinguishable from stolen-token reuse and revoke the customer's
 * whole session family. See `refresh.ts`'s own doc comment.
 *
 * **A replayed (cache-hit) response cannot re-issue cookies.** The
 * idempotency store must never hold a working session — only token
 * HASHES are ever persisted anywhere in this app (workspace authentication
 * non-negotiable) — so the cached record intentionally carries no token
 * value to write back into a `Set-Cookie` header on replay. The accepted
 * fallback if a client's connection genuinely drops after the server
 * already rotated the token but before the response arrived: the client
 * still holds its now-superseded cookie, its next real attempt presents an
 * already-rotated token, and `rotateRefreshToken` reads that as reuse and
 * revokes the family — a forced re-login, not a security gap. Safe-but-
 * inconvenient over convenient-but-insecure, deliberately.
 *
 * No body: successful responses carry nothing but fresh cookies, so this
 * route always answers `204`.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 204,
  handler: async ({ request }) => {
    const presentedToken = readTokenCookie(request, CUSTOMER_REFRESH_COOKIE);
    if (!presentedToken) throw new UnauthorizedError();

    const claim = await claimIdempotentMutation({
      route: ROUTE,
      actorId: hashVerificationToken(presentedToken),
      request,
      body: undefined,
    });
    if (!claim.claimed) return undefined;

    try {
      await refreshCustomerSession(presentedToken);
      await completeIdempotentMutation(claim, { status: 204, body: undefined });
      return undefined;
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});
