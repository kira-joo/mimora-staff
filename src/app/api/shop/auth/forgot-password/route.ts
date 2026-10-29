import { requestPasswordReset } from "src/server/shop/auth/forgot-password";
import { ForgotPasswordDto } from "src/server/shop/dto/forgot-password.dto";
import { RATE_LIMITS, enforceAddressAndAccountLimits } from "src/server/core/rate-limit/enforce-rate-limit";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "src/server/core/idempotency/scoped-idempotency";
import { createPostRoute } from "src/server/core/route-factories";

const ROUTE = "POST /api/shop/auth/forgot-password";

/**
 * `auth: false` — pre-session by definition. Exempted in
 * `shop-route-coverage.test.ts`'s `NO_ACTOR_EXEMPT`.
 *
 * Always `204`, identical whether or not `identifier` matched an account —
 * see `requestPasswordReset`'s own doc comment on the enumeration-oracle
 * principle this enforces. Idempotency is scoped by the submitted
 * `identifier` itself (phone or email), the closest thing this route has
 * to a stable actor.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 204,
  body: ForgotPasswordDto,
  handler: async ({ body, request }) => {
    // Per client address AND per account (canonical phone or lower-cased email), keyed on what was SUBMITTED — never on whether an account matched.
    await enforceAddressAndAccountLimits({
      request,
      scope: "PASSWORD_RESET_REQUEST",
      identifier: body.identifier,
      address: RATE_LIMITS.PASSWORD_RESET_REQUEST_ADDRESS,
      account: RATE_LIMITS.PASSWORD_RESET_REQUEST,
    });

    const claim = await claimIdempotentMutation({ route: ROUTE, actorId: body.identifier, request, body });
    if (!claim.claimed) return undefined;

    try {
      await requestPasswordReset(body.identifier);
      await completeIdempotentMutation(claim, { status: 204, body: undefined });
      return undefined;
    } catch (error) {
      await releaseIdempotentMutation(claim);
      throw error;
    }
  },
});
