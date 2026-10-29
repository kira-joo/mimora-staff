import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminStaffQueryDto } from "../../../../server/admin/dto/list-admin-staff-query.dto";
import { InviteStaffDto } from "../../../../server/admin/dto/invite-staff.dto";
import { listStaff } from "../../../../server/admin/staff/list-staff";
import { inviteStaff } from "../../../../server/admin/staff/invite-staff";
import { CustomPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.STAFF_MANAGE] },
  query: ListAdminStaffQueryDto,
  handler: async ({ query }) => {
    const result = await listStaff(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [CustomPermission.STAFF_MANAGE] },
  body: InviteStaffDto,
  handler: async ({ body }) => {
    const staff = await inviteStaff(body);
    return staff;
  },
});
