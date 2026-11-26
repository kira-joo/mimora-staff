import { createDeleteRoute, createGetRoute, createPutRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateRoleDto } from "../../../../../server/admin/dto/role.dto";
import { deleteRole, getRole, updateRole } from "../../../../../server/admin/roles/manage-roles";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ROLE.READ] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => getRole(params.id),
});

/** Send only what changed. Edits take effect on each holder's next request. */
export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.ROLE.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdateRoleDto,
  handler: async ({ params, body, user }) => updateRole(params.id, body, user),
});

/** Only a role nobody holds; never the Owner role. Answers the deleted role, which the audit trail records. */
export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.ROLE.DELETE] },
  params: MongoIdParamsDto,
  successStatus: 200,
  handler: async ({ params, user }) => deleteRole(params.id, user),
});
