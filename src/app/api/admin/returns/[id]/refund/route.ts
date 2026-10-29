import { toMoney } from "@kira-joo/toolkit-common";
import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { RefundReturnDto } from "../../../../../../server/admin/dto/refund-return.dto";
import { refundReturn } from "../../../../../../server/admin/returns/refund-return";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";
import { runIdempotentMutation } from "../../../../../../server/core/idempotency/run-idempotent-mutation";

const ROUTE = "PUT /api/admin/returns/:id/refund";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.PAYMENT_REFUND] },
  params: MongoIdParamsDto,
  body: RefundReturnDto,
  handler: async ({ request, params, body, user }) =>
    runIdempotentMutation({
      route: ROUTE,
      actorId: user._id,
      request,
      fingerprint: { id: params.id, ...body },
      // Logged as Return.refund, so the entry's id is unambiguously this return (Payment.refund means an order).
      subject: { entityType: "Return" },
      mutation: () =>
        refundReturn({
          returnId: params.id,
          refundReference: body.refundReference,
          amount: toMoney(body.amount),
          staffId: user._id,
          now: new Date(),
        }),
    }),
});
