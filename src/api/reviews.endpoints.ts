import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { LocalizedText } from "./brands.endpoints";

export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface Review {
  _id: string;
  productId: string;
  customerId: string;
  orderId?: string;
  rating: number;
  title: LocalizedText;
  body: LocalizedText;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  moderatedBy?: string;
  moderatedAt?: string;
  createdAt?: string;
  /** Joined by the list API so a moderator sees what the review is about with Review.read alone. */
  productName: LocalizedText;
  customerName: string;
}

export interface ListReviewsQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  status?: ReviewStatus;
  productId?: string;
  [key: string]: unknown;
}

export const listReviewsEndpoint: Endpoint<{ query: ListReviewsQuery; returnType: PaginatedResponse<Review> }> = {
  url: "/admin/reviews",
  methodType: MethodType.GET,
};

/** Approve or reject — a review already in that state is refused with a 409. */
export const moderateReviewEndpoint: Endpoint<{ params: { id: string }; body: { status: "APPROVED" | "REJECTED" }; returnType: Review }> = {
  url: "/admin/reviews/:id/moderate",
  methodType: MethodType.PUT,
};
