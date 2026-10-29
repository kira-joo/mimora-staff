import { createPutRoute } from "../../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../../server/catalog/dto/mongo-id-params.dto";
import { AdjustStockDto } from "../../../../../../server/admin/dto/adjust-stock.dto";
import { adjustStock } from "../../../../../../server/admin/inventory/adjust-stock";
import { CustomPermission } from "../../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [CustomPermission.INVENTORY_ADJUST] },
  params: MongoIdParamsDto,
  body: AdjustStockDto,
  revalidateTags: ["PRODUCTS"],
  handler: async ({ params, body, user }) => {
    const variant = await adjustStock({
      variantId: params.id,
      delta: body.delta,
      reason: body.reason,
      note: body.note,
      staffId: user._id,
      now: new Date(),
    });

    return variant;
  },
});
