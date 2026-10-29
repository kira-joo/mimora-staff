import { addCartLine } from "src/server/shop/cart/add-cart-line";
import { AddCartLineDto } from "src/server/shop/dto/add-cart-line.dto";
import { resolveShopActor } from "src/server/shop/shop-actor";
import { createPostRoute } from "src/server/core/route-factories";

/**
 * `auth: false` — guest checkout is a product requirement (MDS §11.2), so
 * this calls `resolveShopActor`, never `requireCustomer`.
 */
export const POST = createPostRoute({
  auth: false,
  body: AddCartLineDto,
  handler: async ({ body, request }) => addCartLine(await resolveShopActor(request), body),
});
