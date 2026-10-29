import { createGetRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { getReturnDetailAdmin } from "../../../../../server/admin/returns/get-return-detail";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.RETURN.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const ret = await getReturnDetailAdmin(params.id);
    return ret;
  },
});
