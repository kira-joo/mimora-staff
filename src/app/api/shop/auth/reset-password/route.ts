import { resetPassword } from "src/server/shop/auth/reset-password";
import { hashVerificationToken } from "src/server/shop/auth/hash-verification-token";
import { ResetPasswordDto } from "src/server/shop/dto/reset-password.dto";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import { createPostRoute } from "src/server/core/route-factories";

const ROUTE = "POST /api/shop/auth/reset-password";

/**
 * `auth: false` — the presented reset token IS the credential; there is no
 * signed-in actor to resolve. Exempted in `shop-route-coverage.test.ts`'s
 * `NO_ACTOR_EXEMPT`.
 *
 * Idempotency is scoped by a hash of the presented token (the same
 * reasoning as `refresh`'s route: the real subject isn't known until the
 * lookup inside `resetPassword` succeeds, and the token is single-use, so
 * scoping on anything else would either leak nothing to collide on or
 * require resolving the customer before the claim). Not rate-limited on
 * its own — the token is already a high-entropy, single-use, short-lived
 * secret; `forgot-password` is where the attack surface (guessing an
 * identifier) actually is.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 204,
  body: ResetPasswordDto,
  handler: async ({ body, request }) => {
    const claim = await claimIdempotentMutation({ route: ROUTE, actorId: hashVerificationToken(body.token), request, body });
    if (!claim.claimed) return undefined;

    try {
      await resetPassword(body.token, body.newPassword);
      await completeIdempotentMutation(claim, { status: 204, body: undefined });
      return undefined;
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});
