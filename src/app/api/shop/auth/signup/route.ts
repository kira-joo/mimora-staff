import { signupCustomer } from "src/server/shop/auth/signup";
import { SignupDto } from "src/server/shop/dto/signup.dto";
import { RATE_LIMITS, enforceAddressAndAccountLimits } from "src/server/core/rate-limit/enforce-rate-limit";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import { createPostRoute } from "src/server/core/route-factories";

const ROUTE = "POST /api/shop/auth/signup";

/** The one body every signup answers with — new or already registered. */
const ACCEPTED = { status: "accepted" } as const;

/**
 * `auth: false` — no actor exists yet; this route creates one. Exempted in
 * `shop-route-coverage.test.ts`'s `NO_ACTOR_EXEMPT`.
 *
 * **Answers `202 { "status": "accepted" }` identically whether the phone/email
 * was new or already registered, and never sets a cookie** — a distinguishable
 * response (an error, or being signed in) would be an account-existence oracle.
 * The customer signs in through `login`, which is also where a guest cart
 * (`x-cart-token`) is merged; there is no session here to merge into. See
 * `signupCustomer` for the documented residual (timing, and signup-then-login).
 *
 * Idempotency is scoped by the submitted phone number (there is no signed-in
 * actor); a replay returns the same `ACCEPTED` body. Rate-limited per address and
 * per phone — the submitted number is the only identity a signup has.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 202,
  body: SignupDto,
  handler: async ({ body, request }) => {
    // Per client address AND per phone (the DTO already canonicalised it): one number cannot be registered at volume from rotating addresses.
    await enforceAddressAndAccountLimits({ request, scope: "SIGNUP", identifier: body.phone, address: RATE_LIMITS.SIGNUP, account: RATE_LIMITS.SIGNUP_IDENTIFIER });

    const claim = await claimIdempotentMutation({ route: ROUTE, actorId: body.phone, request, body });
    if (!claim.claimed) return ACCEPTED;

    try {
      await signupCustomer(body);
      await completeIdempotentMutation(claim, { status: 202, body: ACCEPTED });
      return ACCEPTED;
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});
