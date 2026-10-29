import { createPutRoute } from "../../../../../server/core/route-factories";
import { ReorderDeliveryZonesDto } from "../../../../../server/admin/dto/reorder-delivery-zones.dto";
import { reorderDeliveryZones } from "../../../../../server/admin/delivery-zones/reorder-delivery-zones";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.DELIVERY_ZONE.UPDATE] },
  successStatus: 204,
  body: ReorderDeliveryZonesDto,
  revalidateTags: ["DELIVERY_ZONES"],
  handler: async ({ body }) => {
    await reorderDeliveryZones({ items: body.items });
    return;
  },
});
