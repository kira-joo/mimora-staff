import { createGetRoute } from "../../../../server/core/route-factories";
import { ListNotificationsQueryDto } from "../../../../server/admin/dto/list-notifications-query.dto";
import { listStaffNotifications } from "../../../../server/admin/notifications/staff-notifications";
import { CustomPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.NOTIFICATION_READ] },
  query: ListNotificationsQueryDto,
  handler: async ({ query, user }) => listStaffNotifications(user, query),
});
