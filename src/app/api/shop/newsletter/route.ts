import { acceptNewsletterSubscription } from "src/server/newsletter/accept-subscription";
import { SubscribeNewsletterDto } from "src/server/newsletter/dto/subscribe-newsletter.dto";
import { RATE_LIMITS, enforceRateLimit, resolveClientIp } from "src/server/core/rate-limit/enforce-rate-limit";
import { createPostRoute } from "src/server/core/route-factories";
import { resolveShopActor } from "src/server/shop/shop-actor";

/** The one body every subscription answers with — new, repeated, or previously unsubscribed. */
const ACCEPTED = { status: "accepted" } as const;

/**
 * POST /api/shop/newsletter — public newsletter capture (footer, checkout).
 *
 * `auth: false` AND no required customer: a guest is the usual caller, and
 * `resolveShopActor` is called so a signed-in visitor subscribing their own
 * account email is recorded as consent on that account (see
 * `acceptNewsletterSubscription`). A present-but-invalid session is still a 401,
 * never a silent downgrade to guest.
 *
 * **Enumeration-safe**: always `202 { status: "accepted" }`, whether the address
 * was new, already subscribed, or had been unsubscribed — a distinguishable answer
 * would tell anyone who is on the list. Malformed input is `400`, which depends only
 * on the input. Rate-limited per client address (the BFF forwards the real one).
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 202,
  body: SubscribeNewsletterDto,
  handler: async ({ body, request }) => {
    await enforceRateLimit({ key: `NEWSLETTER_SUBSCRIBE:ip:${resolveClientIp(request)}`, ...RATE_LIMITS.NEWSLETTER_SUBSCRIBE });

    const actor = await resolveShopActor(request);
    await acceptNewsletterSubscription({ ...body, customer: actor.kind === "customer" ? actor.customer : undefined });
    return ACCEPTED;
  },
});
