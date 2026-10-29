import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateOrderTrackingDto } from "../../../../../../server/admin/dto/update-order-tracking.dto";
import { updateOrderTracking } from "../../../../../../server/admin/orders/update-order-tracking";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";
import { runIdempotentMutation } from "../../../../../../server/core/idempotency/run-idempotent-mutation";

const ROUTE = "PUT /api/admin/orders/:id/tracking";

/** Add or correct a shipped order's carrier + tracking number. Same permission as the status change it extends: whoever may ship an order may say how. */
export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.ORDER_TRANSITION] },
  params: MongoIdParamsDto,
  body: UpdateOrderTrackingDto,
  handler: async ({ request, params, body, user }) =>
    runIdempotentMutation({
      route: ROUTE,
      actorId: user._id,
      request,
      fingerprint: { id: params.id, ...body },
      mutation: () => updateOrderTracking({ orderId: params.id, tracking: body, staffId: user._id, now: new Date() }),
    }),
});
