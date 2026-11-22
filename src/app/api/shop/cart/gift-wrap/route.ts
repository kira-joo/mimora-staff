import { setCartGiftWrap } from "src/server/shop/cart/set-cart-gift-wrap";
import { SetCartGiftWrapDto } from "src/server/shop/dto/set-cart-gift-wrap.dto";
import { resolveShopActor } from "src/server/shop/shop-actor";
import { createPutRoute } from "src/server/core/route-factories";

export const dynamic = "force-dynamic";

/** Ticks or unticks gift box & wrapping on the caller's cart (guest or customer). The price is the quote's job. */
export const PUT = createPutRoute({
  auth: false,
  body: SetCartGiftWrapDto,
  handler: async ({ body, request }) => setCartGiftWrap(await resolveShopActor(request), body.giftWrap),
});
