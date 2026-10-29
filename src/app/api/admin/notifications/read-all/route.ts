import { createPutRoute } from "../../../../../server/core/route-factories";
import { markAllStaffNotificationsRead } from "../../../../../server/admin/notifications/staff-notifications";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.NOTIFICATION_READ] },
  handler: async ({ user }) => markAllStaffNotificationsRead(user),
});
