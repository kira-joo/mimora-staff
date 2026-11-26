import { createPostRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { reinviteStaff } from "../../../../../../server/admin/staff/invite-staff";
import { AppPermission } from "../../../../../../common/authorization/authorization-registry";

/** Re-issues an unactivated staff member's invitation; any earlier token stops working. Same permission as inviting. */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.STAFF_USER.CREATE] },
  successStatus: 200,
  params: MongoIdParamsDto,
  handler: async ({ params, user }) => reinviteStaff(params.id, user),
});
