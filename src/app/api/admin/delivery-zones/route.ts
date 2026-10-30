import { toMoney } from "@kira-joo/toolkit-common";
import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminDeliveryZonesQueryDto } from "../../../../server/admin/dto/list-admin-delivery-zones-query.dto";
import { CreateDeliveryZoneDto } from "../../../../server/admin/dto/create-delivery-zone.dto";
import { listDeliveryZones } from "../../../../server/admin/delivery-zones/list-delivery-zones";
import { deliveryZoneRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";
import { ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { leadDaysRangeProblems } from "../../../../server/fulfilment/delivery-zone-lead-days";

export const GET = createGetRoute({
  auth: { permissions: [AppPermission.DELIVERY_ZONE.READ] },
  query: ListAdminDeliveryZonesQueryDto,
  handler: async ({ query }) => {
    const result = await listDeliveryZones(query);
    return result;
  },
});

export const POST = createPostRoute({
  auth: { permissions: [AppPermission.DELIVERY_ZONE.CREATE] },
  body: CreateDeliveryZoneDto,
  revalidateTags: ["DELIVERY_ZONES"],
  handler: async ({ body }) => {
    // `leadDays` defaults to 1 in the schema when omitted.
    const problems = leadDaysRangeProblems(body.leadDaysMin, body.leadDays ?? 1);
    if (problems.length > 0) throw new ValidationFailedError(problems);
    const zone = await deliveryZoneRepository.save({
      ...body,
      fee: toMoney(body.fee),
      minimumOrder: body.minimumOrder ? toMoney(body.minimumOrder) : undefined,
    });

    return zone;
  },
});
