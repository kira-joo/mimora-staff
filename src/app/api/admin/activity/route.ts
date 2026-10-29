import { createGetRoute } from "../../../../server/core/route-factories";
import { ListActivityQueryDto } from "../../../../server/admin/dto/list-activity-query.dto";
import { listActivity } from "../../../../server/admin/activity/list-activity";
import { CustomPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.ACTIVITY_READ] },
  query: ListActivityQueryDto,
  handler: async ({ query }) => listActivity(query),
});
