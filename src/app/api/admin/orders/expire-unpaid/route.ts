import { createPostRoute } from "../../../../../server/core/route-factories";
import { expireUnpaidOrders } from "../../../../../server/admin/orders/expire-unpaid-orders";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * POST /api/admin/orders/expire-unpaid — run the unpaid-order sweep now, from the console.
 *
 * Cancels every order still awaiting payment past its method's `autoCancelMinutes`, releasing the stock it held.
 * It is a bulk cancellation, so it needs what a single cancellation needs: `Order.transition`.
 *
 * Naturally idempotent (a cancelled order no longer matches), so unlike the single-order writes it takes no
 * `Idempotency-Key`: a double click cancels nothing the first click did not, and a replayed stale result would
 * only hide that.
 */
export const POST = createPostRoute({
  auth: { permissions: [CustomPermission.ORDER_TRANSITION] },
  successStatus: 200,
  // Each cancelled order released its stock; a sweep that cancelled nothing changed nothing.
  revalidateTags: ({ result }) => (result.cancelled.length > 0 ? ["PRODUCTS"] : []),
  handler: async () => expireUnpaidOrders(new Date()),
});
