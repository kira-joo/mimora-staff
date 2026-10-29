import { createPutRoute } from "../../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../../server/catalog/dto/mongo-id-params.dto";
import { verifyPayment } from "../../../../../../../server/admin/payments/verify-payment";
import { CustomPermission } from "../../../../../../../common/authorization/authorization-registry";
import { runIdempotentMutation } from "../../../../../../../server/core/idempotency/run-idempotent-mutation";

const ROUTE = "PUT /api/admin/orders/:id/payment/verify";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.PAYMENT_VERIFY] },
  params: MongoIdParamsDto,
  handler: async ({ request, params, user }) =>
    runIdempotentMutation({
      route: ROUTE,
      actorId: user._id,
      request,
      fingerprint: { id: params.id },
      mutation: () => verifyPayment({ orderId: params.id, staffId: user._id, now: new Date() }),
    }),
});
