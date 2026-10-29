import { SortOrder } from "@kira-joo/toolkit-common";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";
import { reviewRepository } from "../../core/repositories";
import type { ReviewView } from "./reviews.types";

export interface ListMyReviewsInput {
  customer: CustomerIdentity;
  limit?: number;
  offset?: number;
}

/**
 * Lists the customer's own reviews for `GET /api/shop/reviews/mine` — every
 * status (`PENDING`/`APPROVED`/`REJECTED`), unlike the storefront's
 * `APPROVED`-only public view (`get-reviews.ts`). Never another customer's
 * reviews — scoped by `customerId` at the query, the same ownership
 * pattern as `listOrders`/`listReturns`.
 */
export async function listMyReviews(input: ListMyReviewsInput): Promise<ReviewView[]> {
  const { customer, limit = 20, offset = 0 } = input;

  const reviews = await reviewRepository.findAll({
    where: { customerId: customer._id },
    sort: { field: "createdAt", order: SortOrder.DESC },
    skip: offset,
    take: limit,
  });

  return reviews.map((review) => ({
    reviewId: review._id.toString(),
    productId: review.productId.toString(),
    rating: review.rating,
    title: review.title,
    body: review.body,
    status: review.status,
    verifiedPurchase: review.verifiedPurchase,
  }));
}
