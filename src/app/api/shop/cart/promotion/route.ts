import { applyCartPromotion } from "src/server/shop/cart/apply-cart-promotion";
import { removeCartPromotion } from "src/server/shop/cart/remove-cart-promotion";
import { ApplyCartPromotionDto } from "src/server/shop/dto/apply-cart-promotion.dto";
import { RATE_LIMITS, enforceRateLimit, resolveClientIp } from "src/server/core/rate-limit/enforce-rate-limit";
import { resolveShopActor } from "src/server/shop/shop-actor";
import { createDeleteRoute, createPostRoute } from "src/server/core/route-factories";

/**
 * Rate-limited per MDS §11.5 ("promotion validation") — IP-only, matching
 * `SIGNUP`'s shape, since the abuse pattern is one attacker trying many
 * codes, not many attempts against one target identity.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 200,
  body: ApplyCartPromotionDto,
  handler: async ({ body, request }) => {
    await enforceRateLimit({ key: `PROMOTION_VALIDATION:${resolveClientIp(request)}`, ...RATE_LIMITS.PROMOTION_VALIDATION });
    return applyCartPromotion(await resolveShopActor(request), body.code);
  },
});

export const DELETE = createDeleteRoute({
  auth: false,
  handler: async ({ request }) => removeCartPromotion(await resolveShopActor(request)),
});
