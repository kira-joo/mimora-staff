import { toMoney } from "@kira-joo/toolkit-common";
import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateDeliveryZoneDto } from "../../../../../server/admin/dto/update-delivery-zone.dto";
import { deliveryZoneRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";
import { mapPresent, toUpdateOperators } from "../../../../../server/core/update/optional-update";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.DELIVERY_ZONE.READ_ONE] },
  params: MongoIdParamsDto,
  handler: async ({ params }) => {
    const zone = await deliveryZoneRepository.findOne({ where: { _id: params.id } });
    return zone;
  },
});

export const PUT = createPutRoute({
  auth: { permissions: [AppPermission.DELIVERY_ZONE.UPDATE] },
  params: MongoIdParamsDto,
  body: UpdateDeliveryZoneDto,
  revalidateTags: ["DELIVERY_ZONES"],
  handler: async ({ params, body }) => {
    // minimumOrder: null removes the zone's own minimum, so the store-wide one applies (`resolveShipping`).
    const zone = await deliveryZoneRepository.updateAtomic(
      { _id: params.id },
      toUpdateOperators({ ...body, fee: mapPresent(body.fee, toMoney), minimumOrder: mapPresent(body.minimumOrder, toMoney) }, ["minimumOrder"])
    );

    return zone;
  },
});

export const DELETE = createDeleteRoute({
  auth: { permissions: [AppPermission.DELIVERY_ZONE.DELETE] },
  params: MongoIdParamsDto,
  revalidateTags: ["DELIVERY_ZONES"],
  handler: async ({ params }) => {
    await deliveryZoneRepository.softDelete({ where: { _id: params.id } });
    return;
  },
});
