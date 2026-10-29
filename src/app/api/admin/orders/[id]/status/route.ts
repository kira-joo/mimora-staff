import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateOrderStatusDto } from "../../../../../../server/admin/dto/update-order-status.dto";
import { transitionOrderStatus } from "../../../../../../server/admin/orders/transition-order-status";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";
import { runIdempotentMutation } from "../../../../../../server/core/idempotency/run-idempotent-mutation";

const ROUTE = "PUT /api/admin/orders/:id/status";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.ORDER_TRANSITION] },
  params: MongoIdParamsDto,
  body: UpdateOrderStatusDto,
  // Only CANCELLED releases stock (`releasesStock`); every other transition leaves the listing's signals alone.
  revalidateTags: ({ body }) => (body.status === "CANCELLED" ? ["PRODUCTS"] : []),
  handler: async ({ request, params, body, user }) =>
    runIdempotentMutation({
      route: ROUTE,
      actorId: user._id,
      request,
      fingerprint: { id: params.id, ...body },
      mutation: () =>
        transitionOrderStatus({
          orderId: params.id,
          to: body.status,
          reason: body.reason,
          tracking: { carrierKey: body.carrierKey, trackingNumber: body.trackingNumber },
          staffId: user._id,
          now: new Date(),
        }),
    }),
});
