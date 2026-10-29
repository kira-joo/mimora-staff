import { createGetRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { getCustomerDetailAdmin } from "../../../../../server/admin/customers/get-customer-detail";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.CUSTOMER.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const detail = await getCustomerDetailAdmin(params.id);
    return detail;
  },
});
