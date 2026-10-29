import { createGetRoute } from "../../../../../server/core/route-factories";
import { countUnreadStaffNotifications } from "../../../../../server/admin/notifications/staff-notifications";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.NOTIFICATION_READ] },
  handler: async ({ user }) => ({ unread: await countUnreadStaffNotifications(user) }),
});
