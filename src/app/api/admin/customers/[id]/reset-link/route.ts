import { createPostRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { createCustomerResetLink } from "../../../../../../server/admin/customers/create-reset-link";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";

export const dynamic = "force-dynamic";

/**
 * Staff-assisted password recovery (plan #70): mints a customer reset credential and
 * returns it ONCE for staff to hand over by another channel. Needs
 * `Customer.createResetLink`. Audited by the route factory with the customer's
 * opaque id and no body; the token is only in this response — never stored in
 * plaintext, never in the audit entry, never logged. Answers 200 (it creates a
 * credential, not a resource, and nothing here is cacheable).
 */
export const POST = createPostRoute({
  auth: { permissions: [CustomPermission.CUSTOMER_RESET_LINK] },
  params: MongoIdParamsDto,
  successStatus: 200,
  handler: async ({ params }) => createCustomerResetLink(params.id),
});
