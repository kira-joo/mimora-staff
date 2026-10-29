import { SortOrder } from "@kira-joo/toolkit-common";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { pickupLocationRepository } from "../../core/repositories";
import type { PickupLocationSchema } from "../../fulfilment/pickup-location.schema";
import type { ListAdminPickupLocationsQueryDto } from "../dto/list-admin-pickup-locations-query.dto";

export async function listPickupLocations(query: ListAdminPickupLocationsQueryDto): Promise<PaginatedResponse<PickupLocationSchema>> {
  const { active, ...rest } = query;
  const where: Record<string, unknown> = {};
  if (active !== undefined) where.active = active;

  return pickupLocationRepository.findAllAndCountPublic({
    where,
    sort: { field: "order", order: SortOrder.ASC },
    query: rest,
  });
}
