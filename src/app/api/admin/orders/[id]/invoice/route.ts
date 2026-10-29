import { createGetRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { getInvoiceByOrderId } from "../../../../../../server/invoices/get-invoice";
import { AppPermission } from "../../../../../../common/authorization/authorization-registry";

/** The invoice, built entirely from the order's own snapshots. 404 for an order placed before invoices existed. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ORDER.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => getInvoiceByOrderId(params.id),
});
