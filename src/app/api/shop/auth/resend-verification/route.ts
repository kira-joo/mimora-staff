import { resendVerificationEmail } from "src/server/shop/auth/resend-verification";
import { ResendVerificationDto } from "src/server/shop/dto/resend-verification.dto";
import { RATE_LIMITS, enforceAddressAndAccountLimits } from "src/server/core/rate-limit/enforce-rate-limit";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import { createPostRoute } from "src/server/core/route-factories";

const ROUTE = "POST /api/shop/auth/resend-verification";

/**
 * `auth: false` — pre-session by definition (an unverified customer may not
 * yet be able to authenticate through every surface that assumes a
 * verified email). Exempted in `shop-route-coverage.test.ts`'s
 * `NO_ACTOR_EXEMPT`.
 *
 * Always `204`, identical whether or not `email` matched an unverified
 * account — see `resendVerificationEmail`'s own doc comment. Idempotency
 * is scoped by the submitted email; rate limiting by address and by email.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 204,
  body: ResendVerificationDto,
  handler: async ({ body, request }) => {
    // Per client address AND per submitted email — keyed on the input, never on whether an account matched.
    await enforceAddressAndAccountLimits({
      request,
      scope: "VERIFICATION_RESEND",
      identifier: body.email,
      address: RATE_LIMITS.VERIFICATION_RESEND_ADDRESS,
      account: RATE_LIMITS.VERIFICATION_RESEND,
    });

    const claim = await claimIdempotentMutation({ route: ROUTE, actorId: body.email, request, body });
    if (!claim.claimed) return undefined;

    try {
      await resendVerificationEmail(body.email);
      await completeIdempotentMutation(claim, { status: 204, body: undefined });
      return undefined;
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});
