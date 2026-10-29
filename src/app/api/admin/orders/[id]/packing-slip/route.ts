import { createGetRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { getPackingSlip } from "../../../../../../server/admin/orders/get-fulfilment-documents";
import { AppPermission } from "../../../../../../common/authorization/authorization-registry";

/** The printable packing slip: lines, SKUs, quantities, ship-to or pickup, notes — never a price. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ORDER.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => getPackingSlip(params.id),
});
