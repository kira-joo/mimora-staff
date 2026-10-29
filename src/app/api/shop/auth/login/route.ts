import { loginCustomer, type AuthResponse } from "src/server/shop/auth/login";
import { mergeGuestCartOnSignIn } from "src/server/shop/cart/merge-guest-cart";
import { CART_TOKEN_HEADER } from "src/server/shop/shop-actor";
import { LoginDto } from "src/server/shop/dto/login.dto";
import { RATE_LIMITS, clearRateLimit, enforceAddressAndAccountLimits } from "src/server/core/rate-limit/enforce-rate-limit";
import { createPostRoute } from "src/server/core/route-factories";

/**
 * `auth: false` is deliberate — this route IS the thing that creates a
 * customer session, so there is no actor yet for `requireCustomer()` or
 * `resolveShopActor()` to resolve. Exempted in
 * `shop-route-coverage.test.ts`'s `NO_ACTOR_EXEMPT` for the same reason,
 * shared by every route under `/api/shop/auth/**`.
 *
 * No `claimIdempotentMutation` — a login attempt has no destructive
 * double-effect a retry could cause (issuing a second session is harmless),
 * and it is a deliberately repeatable action.
 *
 * A guest cart (`x-cart-token`) is merged into the customer's on success —
 * `cartMerge: { merged, lineCount }` reports it; see `merge-guest-cart.ts`.
 *
 * Rate-limited by IP AND by account (MDS §11.5), as staff login is: one counter
 * per client address, one per canonical phone — a combined IP+phone key lets an
 * attacker who rotates addresses guess one account without limit. A success
 * clears only the account counter. The domain function has no request access,
 * so enforcement and the post-success `clearRateLimit` live here, not in
 * `loginCustomer`.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 200,
  body: LoginDto,
  handler: async ({ body, request }) => {
    const { accountKey } = await enforceAddressAndAccountLimits({ request, scope: "LOGIN", identifier: body.phone, address: RATE_LIMITS.LOGIN_ADDRESS, account: RATE_LIMITS.LOGIN });

    const result = await loginCustomer(body.phone, body.password);

    await clearRateLimit(accountKey);

    // An `x-cart-token` for a guest cart is folded into the customer's cart. It cannot fail the sign-in.
    const cartMerge = await mergeGuestCartOnSignIn(result._id, request.headers.get(CART_TOKEN_HEADER));
    return { ...result, cartMerge } satisfies AuthResponse;
  },
});
