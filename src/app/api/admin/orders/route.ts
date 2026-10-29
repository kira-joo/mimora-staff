import { createGetRoute } from "../../../../server/core/route-factories";
import { ListAdminOrdersQueryDto } from "../../../../server/admin/dto/list-admin-orders-query.dto";
import { listOrders } from "../../../../server/admin/orders/list-orders";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ORDER.READ] },
  query: ListAdminOrdersQueryDto,
  handler: async ({ query }) => {
    const result = await listOrders(query);
    return result;
  },
});
