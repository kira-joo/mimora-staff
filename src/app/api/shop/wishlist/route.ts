import { createGetRoute, createPostRoute } from "src/server/core/route-factories";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { requireCustomer } from "src/server/shop/shop-actor";
import { ListWishlistQueryDto } from "src/server/shop/dto/list-wishlist-query.dto";
import { AddToWishlistDto } from "src/server/shop/dto/add-to-wishlist.dto";
import { listWishlist } from "src/server/shop/wishlist/list-wishlist";
import { addToWishlist } from "src/server/shop/wishlist/add-to-wishlist";

/**
 * GET /api/shop/wishlist — lists the authenticated customer's wishlist.
 *
 * Returns only items for this customer, sorted by creation date descending.
 * Includes basic product details (slug, name) for each item.
 */
export const GET = createGetRoute({
  auth: false,
  query: ListWishlistQueryDto,
  handler: async ({ request, query }) => {
    const customer = await requireCustomer(request);
    return listWishlist(customer._id, {
      limit: query.limit ?? 50,
      skip: query.skip ?? 0,
    });
  },
});

/**
 * POST /api/shop/wishlist — adds a product to the wishlist.
 *
 * Idempotent: adding the same product twice is a no-op.
 * Rate limited to prevent abuse.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 201,
  body: AddToWishlistDto,
  handler: async ({ request, body }) => {
    const customer = await requireCustomer(request);

    await enforceRateLimit({ key: `WISHLIST_MUTATION:${customer._id}`, ...RATE_LIMITS.WISHLIST_MUTATION });

    return addToWishlist(customer._id, body.productId);
  },
});

export const dynamic = "force-dynamic";
