import { hasRequiredPermissions } from "@kira-joo/backend-toolkit-core";
import { createGetRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { getOrderDetailAdmin } from "../../../../../server/admin/orders/get-order-detail";
import { AppPermission, CustomPermission } from "../../../../../common/authorization/authorization-registry";

/**
 * Order-read is held by every fulfilment and support role, so it never carries a receipt: the payment proofs
 * (and their signed links) are included only when the caller ALSO holds `Payment.verify` — the permission that
 * guards the payments queue, the other place a link is minted. Note the toolkit's default permissionMode is
 * "any": `Payment.verify` is deliberately NOT listed in `auth` below (that would let a verifier read orders it
 * otherwise couldn't); it is checked in the handler as a second, independent gate.
 */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ORDER.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params, user }) => {
    const order = await getOrderDetailAdmin(params.id, { canViewPaymentProofs: hasRequiredPermissions(user, [CustomPermission.PAYMENT_VERIFY]) });
    return order;
  },
});
