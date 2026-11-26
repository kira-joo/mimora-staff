import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminStaffQueryDto } from "../../../../server/admin/dto/list-admin-staff-query.dto";
import { InviteStaffDto } from "../../../../server/admin/dto/invite-staff.dto";
import { listStaff } from "../../../../server/admin/staff/list-staff";
import { inviteStaff } from "../../../../server/admin/staff/invite-staff";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.STAFF_USER.READ] },
  query: ListAdminStaffQueryDto,
  handler: async ({ query }) => {
    const result = await listStaff(query);
    return result;
  },
});

/** Invites a staff member (no password set here). `POST /api/admin/staff/direct` is the alternative that sets one. */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.STAFF_USER.CREATE] },
  body: InviteStaffDto,
  handler: async ({ body, user }) => {
    const staff = await inviteStaff(body, user);
    return staff;
  },
});
