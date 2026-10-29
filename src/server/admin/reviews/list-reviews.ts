import type { LocalizedString } from "@kira-joo/toolkit-common";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { customerRepository, productRepository, reviewRepository } from "../../core/repositories";
import type { ReviewSchema } from "../../content/review.schema";
import type { ListAdminReviewsQueryDto } from "../dto/list-admin-reviews-query.dto";

export type ReviewListItemView = ReviewSchema & {
  /** The reviewed product's name, so a moderator sees what the review is about without a second permission. */
  productName: LocalizedString;
  /** The reviewer's name — never their contact details or account secrets. */
  customerName: string;
};

/**
 * Queue of pending / approved / rejected reviews per MDS §15. Each row
 * carries the product's and the reviewer's display names — one batched
 * lookup each, the same join the inventory list and activity log make — so
 * moderating needs only Review.read, not Product and Customer reads, and the
 * queue is one request rather than one per row.
 */
export async function listReviews(query: ListAdminReviewsQueryDto): Promise<PaginatedResponse<ReviewListItemView>> {
  const { status, productId, ...rest } = query;
  const where: Record<string, unknown> = {};

  if (status) where.status = status;
  if (productId) where.productId = productId;

  const page = await reviewRepository.findAllAndCountPublic({ where, query: rest });

  const productIds = [...new Set(page.data.map((review) => review.productId.toString()))];
  const customerIds = [...new Set(page.data.map((review) => review.customerId.toString()))];
  const products = await productRepository.findByIds(productIds, { select: { name: true } });
  const customers = await customerRepository.findByIds(customerIds, { select: { name: true } });
  const productName = new Map(products.map((product) => [product._id.toString(), product.name]));
  const customerName = new Map(customers.map((customer) => [customer._id.toString(), customer.name]));

  return {
    ...page,
    data: page.data.map((review) => ({
      ...review,
      productName: productName.get(review.productId.toString()) ?? { ar: "", en: "" },
      customerName: customerName.get(review.customerId.toString()) ?? "",
    })),
  };
}
