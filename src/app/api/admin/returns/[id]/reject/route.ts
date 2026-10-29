import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { RejectReturnDto } from "../../../../../../server/admin/dto/reject-return.dto";
import { rejectReturn } from "../../../../../../server/admin/returns/reject-return";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.RETURN_APPROVE] },
  params: MongoIdParamsDto,
  body: RejectReturnDto,
  handler: async ({ params, body, user }) => {
    const ret = await rejectReturn({ returnId: params.id, reason: body.reason, staffId: user._id, now: new Date() });
    return ret;
  },
});
