import { createGetRoute } from "../../../../server/core/route-factories";
import { listAssignablePermissions } from "../../../../server/admin/roles/list-assignable-permissions";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

/** The permissions a role can be given — the rows and columns of the console's permission matrix. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ROLE.READ] },
  handler: async () => {
    const data = await listAssignablePermissions();
    return { data, total: data.length, page: 1, limit: data.length, totalPages: 1 };
  },
});
