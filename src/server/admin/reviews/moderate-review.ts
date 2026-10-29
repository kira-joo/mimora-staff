import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { reviewRepository } from "../../core/repositories";
import { maintainRatingsSummary } from "../../content/rollups/maintain-ratings-summary";

export interface ModerateReviewInput {
  reviewId: string;
  status: "APPROVED" | "REJECTED";
  staffId: string;
  now: Date;
}

/**
 * The single "review moderate" action per MDS §11.3 — one endpoint for
 * both approve and reject, not two routes like Batch 21's returns
 * approve/reject/receive, matching how the canonical route inventory
 * names this one differently ("review moderate", singular).
 *
 * Recomputes `Product.ratingsSummary` only when the transition actually
 * crosses the approved/non-approved boundary, per
 * `maintainRatingsSummary`'s own doc comment — PENDING→REJECTED never
 * touched the summary in the first place.
 */
export async function moderateReview(input: ModerateReviewInput) {
  const { reviewId, status, staffId, now } = input;

  const review = await reviewRepository.findOne({ where: { _id: reviewId } });
  if (review.status === status) {
    throw new ConflictError(`This review is already ${status}.`);
  }

  const crossesApprovalBoundary = (review.status === "APPROVED") !== (status === "APPROVED");

  return withTransaction(async (tx) => {
    const updated = await reviewRepository.update(
      { where: { _id: review._id } },
      { status, moderatedBy: staffId, moderatedAt: now }
    );

    if (crossesApprovalBoundary) {
      await maintainRatingsSummary(review.productId);
    }

    return tx.complete(updated);
  });
}
