import { confirmNewsletterSubscription } from "src/server/newsletter/confirmation";
import { ConfirmNewsletterDto } from "src/server/newsletter/dto/confirm-newsletter.dto";
import { hashVerificationToken } from "src/server/shop/auth/hash-verification-token";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import { createPostRoute } from "src/server/core/route-factories";

const ROUTE = "POST /api/shop/newsletter/confirm";

/**
 * POST /api/shop/newsletter/confirm — the second half of double opt-in. `auth: false`: the presented
 * confirmation token IS the credential (exempted in `shop-route-coverage.test.ts`'s `NO_ACTOR_EXEMPT`), and
 * a subscriber is usually a guest. Single-use; every failure — unknown, expired, already used, since
 * unsubscribed — is the same 401, so the response says nothing about which. Idempotency is scoped by a hash
 * of the presented token (same reasoning as `verify-email`), so a retried request replays its answer.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 204,
  body: ConfirmNewsletterDto,
  handler: async ({ body, request }) => {
    const claim = await claimIdempotentMutation({ route: ROUTE, actorId: hashVerificationToken(body.token), request, body });
    if (!claim.claimed) return undefined;

    try {
      await confirmNewsletterSubscription(body.token);
      await completeIdempotentMutation(claim, { status: 204, body: undefined });
      return undefined;
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});
