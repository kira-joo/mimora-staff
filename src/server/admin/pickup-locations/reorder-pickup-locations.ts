import { PickupLocationModel } from "../../fulfilment/pickup-location.schema";

export interface ReorderPickupLocationsInput {
  items: Array<{ locationId: string; order: number }>;
}

export async function reorderPickupLocations(input: ReorderPickupLocationsInput): Promise<void> {
  await PickupLocationModel.bulkWrite(
    input.items.map((item) => ({
      updateOne: {
        filter: { _id: item.locationId },
        update: { $set: { order: item.order } },
      },
    }))
  );
}
