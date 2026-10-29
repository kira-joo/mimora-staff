import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdatePickupLocationDto } from "../../../../../server/admin/dto/update-pickup-location.dto";
import { pickupLocationRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";
import { toUpdateOperators } from "../../../../../server/core/update/optional-update";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.PICKUP_LOCATION.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const location = await pickupLocationRepository.findOne({ where: { _id: params.id } });
    return location;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.PICKUP_LOCATION.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdatePickupLocationDto,
  revalidateTags: ["PICKUP_LOCATIONS"],
  handler: async ({ params, body }) => {
    // coordinates: null removes them — a location without geocoding is valid (the schema's own note).
    const location = await pickupLocationRepository.updateAtomic({ _id: params.id }, toUpdateOperators({ ...body }, ["coordinates"]));

    return location;
  },
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.PICKUP_LOCATION.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["PICKUP_LOCATIONS"],
  handler: async ({ params }) => {
    await pickupLocationRepository.update({ where: { _id: params.id } }, { active: false });
    return;
  },
});
