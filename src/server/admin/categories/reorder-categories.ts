import { CategoryModel } from "../../catalog/category.schema";

export interface ReorderCategoriesInput {
  items: Array<{ categoryId: string; sortOrder: number }>;
}

/**
 * Bulk `sortOrder` write for drag-and-drop reordering. Single collection,
 * cosmetic-only field — no transaction needed (constitution's transaction
 * rule targets multi-collection writes and money/stock-moving ones).
 */
export async function reorderCategories(input: ReorderCategoriesInput): Promise<void> {
  await CategoryModel.bulkWrite(
    input.items.map((item) => ({
      updateOne: {
        filter: { _id: item.categoryId },
        update: { $set: { sortOrder: item.sortOrder } },
      },
    }))
  );
}
