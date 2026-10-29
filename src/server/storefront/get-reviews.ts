import type { LocalizedString, PaginatedResponse } from "@kira-joo/toolkit-common";
import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";
import { reviewRepository } from "../core/repositories";

/**
 * The public face of a review. Never the reviewer's identity (`customerId`,
 * `customerProductKey`), the order it came from, or moderation state — this
 * route is unauthenticated.
 */
export interface PublicReviewView {
  _id: string;
  rating: number;
  title: LocalizedString;
  body: LocalizedString;
  verifiedPurchase: boolean;
  createdAt: Date;
}

/** Only `APPROVED` reviews for the given product — `PENDING`/`REJECTED` are never customer-visible. */
export async function getReviewsForProduct(productId: string, page?: number, limit?: number): Promise<PaginatedResponse<PublicReviewView>> {
  const query = new BaseFindQueryDto();
  query.page = page;
  query.limit = limit;

  const result = await reviewRepository.findAllAndCountPublic({ where: { productId, status: "APPROVED" }, query });

  return {
    ...result,
    data: result.data.map((review) => ({
      _id: review._id.toString(),
      rating: review.rating,
      title: review.title,
      body: review.body,
      verifiedPurchase: review.verifiedPurchase,
      createdAt: (review as unknown as { createdAt: Date }).createdAt,
    })),
  };
}
