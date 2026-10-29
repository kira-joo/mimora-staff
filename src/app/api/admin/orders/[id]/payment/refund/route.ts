import { toMoney } from "@kira-joo/toolkit-common";
import { createPutRoute } from "../../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../../server/catalog/dto/mongo-id-params.dto";
import { RefundPaymentDto } from "../../../../../../../server/admin/dto/refund-payment.dto";
import { refundPayment } from "../../../../../../../server/admin/payments/refund-payment";
import { CustomPermission } from "../../../../../../../common/authorization/authorization-registry";
import { runIdempotentMutation } from "../../../../../../../server/core/idempotency/run-idempotent-mutation";

const ROUTE = "PUT /api/admin/orders/:id/payment/refund";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.PAYMENT_REFUND] },
  params: MongoIdParamsDto,
  body: RefundPaymentDto,
  handler: async ({ request, params, body, user }) =>
    runIdempotentMutation({
      route: ROUTE,
      actorId: user._id,
      request,
      fingerprint: { id: params.id, ...body },
      mutation: () =>
        refundPayment({
          orderId: params.id,
          amount: toMoney(body.amount),
          reason: body.reason,
          reference: body.reference,
          staffId: user._id,
          now: new Date(),
        }),
    }),
});
