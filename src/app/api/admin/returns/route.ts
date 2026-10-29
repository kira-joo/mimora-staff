import { createGetRoute } from "../../../../server/core/route-factories";
import { ListAdminReturnsQueryDto } from "../../../../server/admin/dto/list-admin-returns-query.dto";
import { listReturns } from "../../../../server/admin/returns/list-returns";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.RETURN.READ] },
  query: ListAdminReturnsQueryDto,
  handler: async ({ query }) => {
    const result = await listReturns(query);
    return result;
  },
});
