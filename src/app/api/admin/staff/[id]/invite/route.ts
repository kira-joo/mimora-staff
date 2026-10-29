import { createPostRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { reinviteStaff } from "../../../../../../server/admin/staff/invite-staff";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";

/** Re-issues an unactivated staff member's invitation; any earlier token stops working. */
export const POST = createPostRoute({
  auth: { permissions: [CustomPermission.STAFF_MANAGE] },
  successStatus: 200,
  params: MongoIdParamsDto,
  handler: async ({ params }) => reinviteStaff(params.id),
});
