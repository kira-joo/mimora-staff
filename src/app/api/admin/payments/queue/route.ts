import { createGetRoute } from "../../../../../server/core/route-factories";
import { ListPaymentQueueQueryDto } from "../../../../../server/admin/dto/list-payment-queue-query.dto";
import { listPaymentQueue } from "../../../../../server/admin/payments/list-payment-queue";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * The ONLY route that mints a signed link to a customer's receipt (bank data), so it needs the
 * permission to verify payments — not order-read, which every fulfilment and support role holds
 * (2026-10-22: the console already hid this page without Payment.verify, but the API answered
 * order-read, so those roles could fetch receipt links directly). Note the toolkit's default
 * permissionMode is "any": listing Order.read beside it would re-open the hole.
 */
export const GET = createGetRoute({
  auth: { permissions: [CustomPermission.PAYMENT_VERIFY] },
  query: ListPaymentQueueQueryDto,
  handler: async ({ query }) => {
    const result = await listPaymentQueue(query);
    return result;
  },
});
