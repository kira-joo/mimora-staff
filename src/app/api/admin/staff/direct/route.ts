import { createPostRoute } from "../../../../../server/core/route-factories";
import { CreateStaffDirectDto } from "../../../../../server/admin/dto/create-staff-direct.dto";
import { createStaffDirect } from "../../../../../server/admin/staff/create-staff-direct";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * Creates an active account with an administrator-chosen password (hashed; never returned, redacted from the audit
 * trail). The invitation route beside it is unchanged. Same permission and grant rules as inviting.
 */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.STAFF_USER.CREATE] },
  body: CreateStaffDirectDto,
  handler: async ({ body, user }) => createStaffDirect(body, user),
});
