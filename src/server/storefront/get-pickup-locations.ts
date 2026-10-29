import { SortOrder } from "@kira-joo/toolkit-common";
import { pickupLocationRepository } from "../core/repositories";
import type { PickupLocationSchema } from "../fulfilment/pickup-location.schema";

/** Active pickup locations only, in display order. */
export async function getPickupLocations(): Promise<PickupLocationSchema[]> {
  return pickupLocationRepository.findAll({ where: { active: true }, sort: { field: "order", order: SortOrder.ASC } });
}
