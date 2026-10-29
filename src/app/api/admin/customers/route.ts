import { createGetRoute } from "../../../../server/core/route-factories";
import { ListAdminCustomersQueryDto } from "../../../../server/admin/dto/list-admin-customers-query.dto";
import { listCustomers } from "../../../../server/admin/customers/list-customers";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.CUSTOMER.READ] },
  query: ListAdminCustomersQueryDto,
  handler: async ({ query }) => {
    const result = await listCustomers(query);
    return result;
  },
});
