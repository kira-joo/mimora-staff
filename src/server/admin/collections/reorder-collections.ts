import { CollectionModel } from "../../catalog/collection.schema";

export interface ReorderCollectionsInput {
  items: Array<{ collectionId: string; sortOrder: number }>;
}

/** Bulk `sortOrder` write for drag-and-drop reordering — single collection, cosmetic-only field, no transaction needed. */
export async function reorderCollections(input: ReorderCollectionsInput): Promise<void> {
  await CollectionModel.bulkWrite(
    input.items.map((item) => ({
      updateOne: {
        filter: { _id: item.collectionId },
        update: { $set: { sortOrder: item.sortOrder } },
      },
    }))
  );
}
