import { SortOrder } from "@kira-joo/toolkit-common";
import { deliveryZoneRepository } from "../core/repositories";
import type { DeliveryZoneSchema } from "../fulfilment/delivery-zone.schema";

/**
 * Active zones only, in display order. Goes through the repository, not
 * the raw model — `DeliveryZone` opted into soft delete, and that
 * filtering is a repository-layer concern (see `repositories.ts`'s own
 * comment on `deliveryZoneRepository`); a raw `Model.find()` would
 * silently include soft-deleted zones.
 */
export async function getDeliveryZones(): Promise<DeliveryZoneSchema[]> {
  return deliveryZoneRepository.findAll({ where: { active: true }, sort: { field: "order", order: SortOrder.ASC } });
}
