import { createGetRoute } from "src/server/core/route-factories";
import { OrderNumberParamsDto } from "src/server/shop/dto/order-number-params.dto";
import { resolveOrderAccess } from "src/server/shop/order/order-access";
import { getOrderDetail } from "src/server/shop/order/get-order-detail";

/**
 * GET /api/shop/orders/[orderNumber] — retrieve full order detail.
 *
 * `resolveOrderAccess`: the owning customer's session, or a guest's
 * `x-order-access-token`. Anything else is the same 404 as a missing order.
 *
 * Response: OrderDetailView
 */
export const GET = createGetRoute({
  auth: false,
  params: OrderNumberParamsDto,
  handler: async ({ request, params }) => {
    const { owner } = await resolveOrderAccess(request, params.orderNumber);

    return getOrderDetail({ ...owner, orderNumber: params.orderNumber, now: new Date() });
  },
});

export const dynamic = "force-dynamic";
