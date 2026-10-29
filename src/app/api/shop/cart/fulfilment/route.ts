import { setCartFulfilment } from "src/server/shop/cart/set-cart-fulfilment";
import { SetCartFulfilmentDto } from "src/server/shop/dto/set-cart-fulfilment.dto";
import { resolveShopActor } from "src/server/shop/shop-actor";
import { createPutRoute } from "src/server/core/route-factories";

export const PUT = createPutRoute({
  auth: false,
  body: SetCartFulfilmentDto,
  handler: async ({ body, request }) => setCartFulfilment(await resolveShopActor(request), body),
});
