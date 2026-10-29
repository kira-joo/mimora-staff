import { createGetRoute } from "src/server/core/route-factories";
import { ListReviewsQueryDto } from "src/server/shop/dto/list-reviews-query.dto";
import { requireCustomer } from "src/server/shop/shop-actor";
import { listMyReviews } from "src/server/shop/reviews/list-my-reviews";

/**
 * GET /api/shop/reviews/mine — the customer's own review history, every
 * status (`PENDING`/`APPROVED`/`REJECTED`) — unlike the storefront's
 * `APPROVED`-only public view.
 */
export const GET = createGetRoute({
  auth: false,
  query: ListReviewsQueryDto,
  handler: async ({ request, query }) => {
    const customer = await requireCustomer(request);

    return listMyReviews({ customer, limit: query.limit, offset: query.offset });
  },
});

export const dynamic = "force-dynamic";
