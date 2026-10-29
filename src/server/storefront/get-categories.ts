import { SortOrder } from "@kira-joo/toolkit-common";
import { categoryRepository } from "../core/repositories";
import type { CategorySchema } from "../catalog/category.schema";

/**
 * Every published category, flat — the consumer nests them client-side via
 * `parentId`. Sorted by `sortOrder` within the flat list, which is enough
 * for a consumer to sort correctly within each parent after nesting.
 */
export async function getCategories(): Promise<CategorySchema[]> {
  return categoryRepository.findAll({ where: { published: true }, sort: { field: "sortOrder", order: SortOrder.ASC } });
}
