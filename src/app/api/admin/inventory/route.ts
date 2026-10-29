import { createGetRoute } from "../../../../server/core/route-factories";
import { ListAdminInventoryQueryDto } from "../../../../server/admin/dto/list-admin-inventory-query.dto";
import { listInventory } from "../../../../server/admin/inventory/list-inventory";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.VARIANT.READ] },
  query: ListAdminInventoryQueryDto,
  handler: async ({ query }) => {
    const result = await listInventory(query);
    return result;
  },
});
