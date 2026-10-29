import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { markStaffNotificationRead } from "../../../../../../server/admin/notifications/staff-notifications";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.NOTIFICATION_READ] },
  params: MongoIdParamsDto,
  handler: async ({ params, user }) => markStaffNotificationRead(user, params.id),
});
