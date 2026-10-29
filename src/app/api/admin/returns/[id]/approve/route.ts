import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { approveReturn } from "../../../../../../server/admin/returns/approve-return";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.RETURN_APPROVE] },
  params: MongoIdParamsDto,
  handler: async ({ params, user }) => {
    const ret = await approveReturn({ returnId: params.id, staffId: user._id, now: new Date() });
    return ret;
  },
});
