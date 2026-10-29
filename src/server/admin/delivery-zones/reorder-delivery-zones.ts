import { DeliveryZoneModel } from "../../fulfilment/delivery-zone.schema";

export interface ReorderDeliveryZonesInput {
  items: Array<{ zoneId: string; order: number }>;
}

/** Bulk `order` write for drag-and-drop reordering — single collection, cosmetic-only field, no transaction needed. */
export async function reorderDeliveryZones(input: ReorderDeliveryZonesInput): Promise<void> {
  await DeliveryZoneModel.bulkWrite(
    input.items.map((item) => ({
      updateOne: {
        filter: { _id: item.zoneId },
        update: { $set: { order: item.order } },
      },
    }))
  );
}
