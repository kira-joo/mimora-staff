import { toMoney } from "@kira-joo/toolkit-common";
import { createGetRoute, createPutRoute, createDeleteRoute } from "../../../../../server/core/route-factories";
import { MongoIdParamsDto } from "../../../../../server/catalog/dto/mongo-id-params.dto";
import { UpdateDeliveryZoneDto } from "../../../../../server/admin/dto/update-delivery-zone.dto";
import { deliveryZoneRepository } from "../../../../../server/core/repositories";
import { AppPermission } from "../../../../../common/authorization/authorization-registry";
import { mapPresent, toUpdateOperators } from "../../../../../server/core/update/optional-update";
import { ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { leadDaysRangeProblems } from "../../../../../server/fulfilment/delivery-zone-lead-days";

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
    // The estimate range is checked against what the zone will hold: a bound the body omits keeps its stored value.
    if (body.leadDays !== undefined || body.leadDaysMin !== undefined) {
      const current = await deliveryZoneRepository.findOne({ where: { _id: params.id }, select: { leadDays: true, leadDaysMin: true }, lean: true });
      const problems = leadDaysRangeProblems(body.leadDaysMin === undefined ? current.leadDaysMin : body.leadDaysMin, body.leadDays ?? current.leadDays);
      if (problems.length > 0) throw new ValidationFailedError(problems);
    }
    // minimumOrder / leadDaysMin: null removes the zone's own value — the store-wide minimum, or a window opening at dispatch.
    const zone = await deliveryZoneRepository.updateAtomic(
      { _id: params.id },
      toUpdateOperators({ ...body, fee: mapPresent(body.fee, toMoney), minimumOrder: mapPresent(body.minimumOrder, toMoney) }, ["minimumOrder", "leadDaysMin"])
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
