import { createPostRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { RedactCustomerDto } from "../../../../../../server/admin/dto/redact-customer.dto";
import { redactCustomer } from "../../../../../../server/admin/customers/redact-customer";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";

export const dynamic = "force-dynamic";

/**
 * Redacts a customer account — see `redactCustomer` for exactly what is destroyed
 * and what is kept. Needs its own permission (`Customer.redact`), a reason from a
 * closed list and the literal confirmation. Audited by the route factory (entity
 * `Customer`, action `redact`, the customer's opaque id and the reason code); the
 * response carries no personal data, so nothing the audit trail holds can identify
 * the person. Answers 200 with `{ _id, redactedAt }`; a repeat is 409.
 */
export const POST = createPostRoute({
  auth: { permissions: [CustomPermission.CUSTOMER_REDACT] },
  params: MongoIdParamsDto,
  body: RedactCustomerDto,
  successStatus: 200,
  handler: async ({ params }) => redactCustomer(params.id),
});
