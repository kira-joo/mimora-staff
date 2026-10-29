import { createDeleteRoute } from "src/server/core/route-factories";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { requireCustomer } from "src/server/shop/shop-actor";
import { ProductIdParamsDto } from "src/server/shop/dto/product-id-params.dto";
import { removeFromWishlist } from "src/server/shop/wishlist/remove-from-wishlist";

/**
 * DELETE /api/shop/wishlist/[productId] — removes a product from the wishlist.
 *
 * Idempotent: removing a product that isn't in the wishlist is a no-op.
 * Rate limited.
 */
export const DELETE = createDeleteRoute({
  auth: false,
  params: ProductIdParamsDto,
  handler: async ({ request, params }) => {
    const customer = await requireCustomer(request);

    await enforceRateLimit({ key: `WISHLIST_MUTATION:${customer._id}`, ...RATE_LIMITS.WISHLIST_MUTATION });

    await removeFromWishlist(customer._id, params.productId);
    return { message: "Product removed from wishlist" };
  },
});

export const dynamic = "force-dynamic";
