import { createGetRoute } from "../../../../server/core/route-factories";
import { ListAdminRolesQueryDto } from "../../../../server/admin/dto/list-admin-roles-query.dto";
import { roleRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

/**
 * Read-only. v1 ships five predefined personas (`seed-default-roles.ts`)
 * with no create/edit/delete route — a deliberate scope decision for this
 * app, not an oversight: `nutrition-staff`/`restaurant-platform-staff` both
 * expose full role CRUD, but this product's MDS §2 calls for five fixed
 * personas, editable only by a future, explicitly-scoped batch.
 */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ROLE.READ] },
  query: ListAdminRolesQueryDto,
  handler: async ({ query }) => {
    const result = await roleRepository.findAllAndCountPublic({ query, relations: ["permissions"] });
    return result;
  },
});
