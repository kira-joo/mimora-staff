import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminPickupLocationsQueryDto } from "../../../../server/admin/dto/list-admin-pickup-locations-query.dto";
import { CreatePickupLocationDto } from "../../../../server/admin/dto/create-pickup-location.dto";
import { listPickupLocations } from "../../../../server/admin/pickup-locations/list-pickup-locations";
import { pickupLocationRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PICKUP_LOCATION.READ] },
  query: ListAdminPickupLocationsQueryDto,
  handler: async ({ query }) => {
    const result = await listPickupLocations(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.PICKUP_LOCATION.CREATE] },
  body: CreatePickupLocationDto,
  revalidateTags: ["PICKUP_LOCATIONS"],
  handler: async ({ body }) => {
    const location = await pickupLocationRepository.save(body);

    return location;
  },
});
