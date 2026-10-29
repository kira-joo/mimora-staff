import { getCart } from "src/server/shop/get-cart";
import { resolveShopActor } from "src/server/shop/shop-actor";
import { createGetRoute } from "src/server/core/route-factories";

/**
 * `auth: false` is deliberate here, not an oversight — see
 * `resolveShopActor`'s own doc comment. The toolkit's global `auth` audience
 * is staff; this route resolves its own actor, and a guest cart is a
 * legitimate actor, not an error.
 */
export const GET = createGetRoute({
  auth: false,
  handler: async ({ request }) => getCart(await resolveShopActor(request)),
});
