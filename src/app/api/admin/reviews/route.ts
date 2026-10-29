import { createGetRoute } from "../../../../server/core/route-factories";
import { ListAdminReviewsQueryDto } from "../../../../server/admin/dto/list-admin-reviews-query.dto";
import { listReviews } from "../../../../server/admin/reviews/list-reviews";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.REVIEW.READ] },
  query: ListAdminReviewsQueryDto,
  handler: async ({ query }) => {
    const result = await listReviews(query);
    return result;
  },
});
