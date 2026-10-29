import { SortOrder } from "@kira-joo/toolkit-common";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { deliveryZoneRepository } from "../../core/repositories";
import type { DeliveryZoneSchema } from "../../fulfilment/delivery-zone.schema";
import type { ListAdminDeliveryZonesQueryDto } from "../dto/list-admin-delivery-zones-query.dto";

export async function listDeliveryZones(query: ListAdminDeliveryZonesQueryDto): Promise<PaginatedResponse<DeliveryZoneSchema>> {
  const { active, ...rest } = query;
  const where: Record<string, unknown> = {};
  if (active !== undefined) where.active = active;

  return deliveryZoneRepository.findAllAndCountPublic({
    where,
    sort: { field: "order", order: SortOrder.ASC },
    query: rest,
  });
}
