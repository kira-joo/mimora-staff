import { createPutRoute } from "../../../../../server/core/route-factories";
import { ReorderPickupLocationsDto } from "../../../../../server/admin/dto/reorder-pickup-locations.dto";
import { reorderPickupLocations } from "../../../../../server/admin/pickup-locations/reorder-pickup-locations";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PICKUP_LOCATION.UPDATE] },
  successStatus: 204,
  body: ReorderPickupLocationsDto,
  revalidateTags: ["PICKUP_LOCATIONS"],
  handler: async ({ body }) => {
    await reorderPickupLocations({ items: body.items });
    return;
  },
});
