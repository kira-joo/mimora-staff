import { removeCartLine } from "src/server/shop/cart/remove-cart-line";
import { updateCartLineQuantity } from "src/server/shop/cart/update-cart-line-quantity";
import { CartLineIdParamsDto } from "src/server/shop/dto/cart-line-id-params.dto";
import { UpdateCartLineQuantityDto } from "src/server/shop/dto/update-cart-line-quantity.dto";
import { resolveShopActor } from "src/server/shop/shop-actor";
import { createDeleteRoute, createPutRoute } from "src/server/core/route-factories";

export const PUT = createPutRoute({
  auth: false,
  params: CartLineIdParamsDto,
  body: UpdateCartLineQuantityDto,
  handler: async ({ params, body, request }) =>
    updateCartLineQuantity(await resolveShopActor(request), params.lineId, body.quantity),
});

export const DELETE = createDeleteRoute({
  auth: false,
  params: CartLineIdParamsDto,
  handler: async ({ params, request }) => removeCartLine(await resolveShopActor(request), params.lineId),
});
