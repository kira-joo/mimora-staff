import { toMoney } from "@kira-joo/toolkit-common";
import { createGetRoute, createPostRoute } from "../../../../server/core/route-factories";
import { ListAdminDeliveryZonesQueryDto } from "../../../../server/admin/dto/list-admin-delivery-zones-query.dto";
import { CreateDeliveryZoneDto } from "../../../../server/admin/dto/create-delivery-zone.dto";
import { listDeliveryZones } from "../../../../server/admin/delivery-zones/list-delivery-zones";
import { deliveryZoneRepository } from "../../../../server/core/repositories";
import { AppPermission } from "../../../../common/authorization/authorization-registry";

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
    const zone = await deliveryZoneRepository.save({
      ...body,
      fee: toMoney(body.fee),
      minimumOrder: body.minimumOrder ? toMoney(body.minimumOrder) : undefined,
    });

    return zone;
  },
});
