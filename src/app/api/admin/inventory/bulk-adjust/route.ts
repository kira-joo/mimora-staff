import { createPutRoute } from "../../../../../server/core/route-factories";
import { BulkAdjustStockDto } from "../../../../../server/admin/dto/bulk-adjust-stock.dto";
import { bulkAdjustStock } from "../../../../../server/admin/inventory/bulk-adjust-stock";
import { CustomPermission } from "../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.INVENTORY_ADJUST] },
  body: BulkAdjustStockDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ body, user }) => {
    const variants = await bulkAdjustStock({ items: body.items, staffId: user._id, now: new Date() });
    return { data: variants };
  },
});
