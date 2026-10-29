import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { ModerateReviewDto } from "../../../../../../server/admin/dto/moderate-review.dto";
import { moderateReview } from "../../../../../../server/admin/reviews/moderate-review";
import { AppPermission } from "../../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.REVIEW.UPDATE] },
  params: MongoIdParamsDto,
  body: ModerateReviewDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params, body, user }) => {
    const review = await moderateReview({ reviewId: params.id, status: body.status, staffId: user._id, now: new Date() });
    return review;
  },
});
