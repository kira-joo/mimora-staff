import { verifyEmail } from "src/server/shop/auth/verify-email";
import { hashVerificationToken } from "src/server/shop/auth/hash-verification-token";
import { VerifyEmailDto } from "src/server/shop/dto/verify-email.dto";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import { createPostRoute } from "src/server/core/route-factories";

const ROUTE = "POST /api/shop/auth/verify-email";

/**
 * `auth: false` — the presented verification token IS the credential.
 * Exempted in `shop-route-coverage.test.ts`'s `NO_ACTOR_EXEMPT`. Idempotency
 * scoped by a hash of the presented token, same reasoning as
 * `reset-password`.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 204,
  body: VerifyEmailDto,
  handler: async ({ body, request }) => {
    const claim = await claimIdempotentMutation({ route: ROUTE, actorId: hashVerificationToken(body.token), request, body });
    if (!claim.claimed) return undefined;

    try {
      await verifyEmail(body.token);
      await completeIdempotentMutation(claim, { status: 204, body: undefined });
      return undefined;
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});
