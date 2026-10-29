import { createPostRoute } from "src/server/core/route-factories";
import { OrderNumberParamsDto } from "src/server/shop/dto/order-number-params.dto";
import { CancelOrderDto } from "src/server/shop/dto/cancel-order.dto";
import { resolveOrderAccess } from "src/server/shop/order/order-access";
import { cancelOrder } from "src/server/shop/order/cancel-order";

/**
 * POST /api/shop/orders/[orderNumber]/cancel — customer cancels their own order.
 *
 * `resolveOrderAccess`: the owning customer's session, or a guest's
 * `x-order-access-token`. Status and the time window are validated in the service.
 *
 * Request body: { reason?: string }
 * Response: { success: true }
 */
export const POST = createPostRoute({
  auth: false,
  successStatus: 200,
  params: OrderNumberParamsDto,
  body: CancelOrderDto,
  // Cancelling returns the order's stock and rewrites the listing rollups the storefront's ISR pages show.
  revalidateTags: ["PRODUCTS"],
  handler: async ({ request, params, body }) => {
    const { owner } = await resolveOrderAccess(request, params.orderNumber);

    return cancelOrder({
      ...owner,
      orderNumber: params.orderNumber,
      reason: body.reason,
      now: new Date(),
    });
  },
});

export const dynamic = "force-dynamic";
