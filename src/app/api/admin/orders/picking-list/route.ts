import { createGetRoute } from "../../../../../server/core/route-factories";
import { PickingListQueryDto } from "../../../../../server/admin/dto/picking-list-query.dto";
import { getPickingList } from "../../../../../server/admin/orders/get-fulfilment-documents";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/** A picking list for the selected orders, aggregated per SKU. Spans orders, so it needs list-level order access. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.ORDER.READ] },
  query: PickingListQueryDto,
  handler: async ({ query }) => getPickingList(query.ids),
});
