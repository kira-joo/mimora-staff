import { resolveSession } from "@kira-joo/backend-toolkit-mongoose";
import type { Types } from "mongoose";
import { productRepository } from "../../core/repositories";
import { ReviewModel } from "../review.schema";

/**
 * Recomputes and writes `Product.ratingsSummary{}` from the product's
 * currently-`APPROVED` reviews, inside the caller's transaction.
 *
 * Same recompute-via-aggregation discipline as
 * `catalog/rollups/maintain-product-listing.ts`, for the same reason: an
 * incrementally-maintained running average drifts under edit/removal
 * (removing a rating from a running average needs the OLD rating, which a
 * caller might not have handy, and floating-point accumulation error grows
 * with every operation) where a `$match`+`$group` aggregate is always
 * exactly correct and, for a review-moderation action (not a hot
 * concurrent-write path like stock decrement), cheap enough to just do.
 *
 * Call whenever a `Review.status` transition crosses the approved/
 * non-approved boundary in either direction — first approval, a rejection
 * or removal of a previously-approved review, or (defensively) a rating
 * edited while still approved. **A review that is edited after approval
 * must have its `status` reset to `PENDING` by the caller before this
 * function is relevant again** — that reset is the route layer's
 * responsibility (no review-edit route exists yet in this phase); this
 * function only reacts to `status`, it does not enforce the reset.
 *
 * No route calls this yet — integration tests call it directly. Takes no
 * `session` parameter — the aggregate resolves the ambient transaction
 * session itself (a repository cannot express `$group`); the product write
 * goes through the repository.
 */
export async function maintainRatingsSummary(productId: Types.ObjectId): Promise<void> {
  const session = resolveSession();

  // Direct Model use: `aggregate` ($match + $group) is not expressible through the repository.
  const [result] = await ReviewModel.aggregate<{ average: number; count: number }>([
    { $match: { productId, status: "APPROVED" } },
    { $group: { _id: null, average: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]).session(session ?? null);

  await productRepository.updateAtomic(
    { _id: productId },
    { $set: { "ratingsSummary.average": result?.average ?? 0, "ratingsSummary.count": result?.count ?? 0 } },
    { skipThrowError: true }
  );
}
