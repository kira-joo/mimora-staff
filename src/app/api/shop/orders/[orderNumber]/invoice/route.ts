import { createGetRoute } from "src/server/core/route-factories";
import { OrderNumberParamsDto } from "src/server/shop/dto/order-number-params.dto";
import { resolveOrderAccess } from "src/server/shop/order/order-access";
import { getInvoiceForOrder } from "src/server/invoices/get-invoice";

/**
 * GET /api/shop/orders/[orderNumber]/invoice — the customer's invoice for their own order.
 *
 * `resolveOrderAccess`: the owning customer's session, or a guest's `x-order-access-token`. Anything else — another
 * customer's order, a guest without the token, a token for a different order — is the same 404 as an order that does
 * not exist, so an invoice (a name, an address, a phone number) is never confirmed to a stranger. An order placed
 * before invoices existed answers 404 as well.
 *
 * Response: InvoiceView (`invoices/build-invoice-view.ts`) — built from the order's own snapshots.
 */
export const GET = createGetRoute({
  auth: false,
  params: OrderNumberParamsDto,
  handler: async ({ request, params }) => {
    const { order } = await resolveOrderAccess(request, params.orderNumber);

    return getInvoiceForOrder(order);
  },
});

export const dynamic = "force-dynamic";
