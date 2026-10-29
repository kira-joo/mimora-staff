import type { Review, ReviewStatus } from "src/api/reviews.endpoints";

/** Actions the API accepts for a review: it refuses a move to the status it already has. */
export function moderationOptions(status: ReviewStatus): { approve: boolean; reject: boolean } {
  return { approve: status !== "APPROVED", reject: status !== "REJECTED" };
}

/** What rejecting does, for the confirm: only a live (approved) review is on the storefront and in the product's rating. */
export function rejectConsequence(status: ReviewStatus): string {
  return status === "APPROVED"
    ? "It leaves the storefront and stops counting toward the product's rating. You can approve it again later."
    : "It stays off the storefront. You can approve it again later.";
}

/** "★★★★☆"-free: a plain "4 / 5" for assistive tech and figures. */
export function ratingLabel(review: Pick<Review, "rating">): string {
  return `${review.rating} / 5`;
}
