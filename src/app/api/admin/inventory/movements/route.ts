import { createGetRoute } from "../../../../../server/core/route-factories";
import { ListInventoryMovementsQueryDto } from "../../../../../server/admin/dto/list-inventory-movements-query.dto";
import { listMovements } from "../../../../../server/admin/inventory/list-movements";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

/** The Adjustments log. Read-only; `StockMovement.read` is separate from `Variant.read` so stock counts and who changed them can be granted apart. */
export const GET = createGetRoute({
  auth: { permissions: [AppPermission.STOCK_MOVEMENT.READ] },
  query: ListInventoryMovementsQueryDto,
  handler: async ({ query }) => {
    const result = await listMovements(query);
    return result;
  },
});
