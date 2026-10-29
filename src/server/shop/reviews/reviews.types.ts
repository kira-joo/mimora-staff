import type { LocalizedString } from "@kira-joo/toolkit-common";

/**
 * Response shape for `POST /api/shop/reviews` and each row of
 * `GET /api/shop/reviews/mine`. Staff-only moderation fields
 * (`moderatedBy`, `moderatedAt`) are never exposed — the customer-facing
 * contract has no use for them.
 */
export interface ReviewView {
  reviewId: string;
  productId: string;
  rating: number;
  title: LocalizedString;
  body: LocalizedString;
  status: "PENDING" | "APPROVED" | "REJECTED";
  verifiedPurchase: boolean;
}
