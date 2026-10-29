import { createPutRoute } from "../../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../../server/catalog/dto/mongo-id-params.dto";
import { RejectPaymentDto } from "../../../../../../../server/admin/dto/reject-payment.dto";
import { rejectPayment } from "../../../../../../../server/admin/payments/reject-payment";
import { CustomPermission } from "../../../../../../../common/authorization/authorization-registry";
import { runIdempotentMutation } from "../../../../../../../server/core/idempotency/run-idempotent-mutation";

const ROUTE = "PUT /api/admin/orders/:id/payment/reject";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.PAYMENT_REJECT] },
  params: MongoIdParamsDto,
  body: RejectPaymentDto,
  handler: async ({ request, params, body, user }) =>
    runIdempotentMutation({
      route: ROUTE,
      actorId: user._id,
      request,
      fingerprint: { id: params.id, ...body },
      mutation: () => rejectPayment({ orderId: params.id, reason: body.reason, staffId: user._id, now: new Date() }),
    }),
});
