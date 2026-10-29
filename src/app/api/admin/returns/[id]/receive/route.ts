import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { ReceiveReturnDto } from "../../../../../../server/admin/dto/receive-return.dto";
import { receiveReturn } from "../../../../../../server/admin/returns/receive-return";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";
import { runIdempotentMutation } from "../../../../../../server/core/idempotency/run-idempotent-mutation";

const ROUTE = "PUT /api/admin/returns/:id/receive";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.RETURN_RECEIVE] },
  params: MongoIdParamsDto,
  body: ReceiveReturnDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ request, params, body, user }) =>
    runIdempotentMutation({
      route: ROUTE,
      actorId: user._id,
      request,
      fingerprint: { id: params.id, ...body },
      mutation: async () => ({ lines: await receiveReturn({ returnId: params.id, lines: body.lines, staffId: user._id, now: new Date() }) }),
    }),
});
