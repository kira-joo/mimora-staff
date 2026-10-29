import { createPostRoute } from "src/server/core/route-factories";
import { RATE_LIMITS, enforceRateLimit } from "src/server/core/rate-limit/enforce-rate-limit";
import { SubmitReviewDto } from "src/server/shop/dto/submit-review.dto";
import { requireCustomer } from "src/server/shop/shop-actor";
import { submitReview } from "src/server/shop/reviews/submit-review";

/**
 * POST /api/shop/reviews — the canonical create-or-edit operation (D-2 —
 * no separate PUT/PATCH route). Submitting again for a product the
 * customer already reviewed edits that review in place via an atomic
 * upsert keyed by `customerProductKey`; it never creates a second one.
 *
 * No `claimIdempotentMutation` (D-4) — the atomic unique-key upsert is
 * itself the duplicate/concurrency protection; a second layer of
 * idempotency would guard against nothing here.
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 201,
  body: SubmitReviewDto,
  handler: async ({ request, body }) => {
    const customer = await requireCustomer(request);

    await enforceRateLimit({ key: `REVIEW_SUBMISSION:${customer._id}`, ...RATE_LIMITS.REVIEW_SUBMISSION });

    const acceptLanguage = request.headers.get("accept-language")?.split(",")[0]?.split("-")[0];
    const locale: "en" | "ar" = acceptLanguage === "ar" ? "ar" : "en";

    return submitReview({
      customer,
      productId: body.productId,
      rating: body.rating,
      title: body.title,
      body: body.body,
      locale,
    });
  },
});

export const dynamic = "force-dynamic";
