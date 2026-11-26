import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminRolesQueryDto } from "../../../../server/admin/dto/list-admin-roles-query.dto";
import { CreateRoleDto } from "../../../../server/admin/dto/role.dto";
import { createRole, listRoles } from "../../../../server/admin/roles/manage-roles";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

/**
 * Roles are fully managed here (`server/admin/roles/manage-roles.ts`): the five seeded personas are an editable
 * starting point, not a fixed set. Roles are few, so the list is returned whole, inside the paginated envelope every
 * list endpoint shares, with each role's member counts.
 */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ROLE.READ] },
  query: ListAdminRolesQueryDto,
  handler: async () => {
    const data = await listRoles();
    return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
  },
});

/** Creates a role. The grant policy refuses permissions the actor does not hold themselves. */
export const POST = createPostRoute({
  auth: { permissions: [AppPermission.ROLE.CREATE] },
  body: CreateRoleDto,
  handler: async ({ body, user }) => createRole(body, user),
});
