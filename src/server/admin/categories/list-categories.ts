import { SortOrder } from "@kira-joo/toolkit-common";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { categoryRepository } from "../../core/repositories";
import type { CategorySchema } from "../../catalog/category.schema";
import type { ListAdminCategoriesQueryDto } from "../dto/list-admin-categories-query.dto";

/** Default sort is the merchandising drag-order (`sortOrder`), not the workspace's usual `createdAt` default — overridden by `query.sortBy` when the caller supplies one. */
export async function listCategories(query: ListAdminCategoriesQueryDto): Promise<PaginatedResponse<CategorySchema>> {
  const { parentId, published, ...rest } = query;
  const where: Record<string, unknown> = {};

  if (parentId) where.parentId = parentId;
  if (published !== undefined) where.published = published;

  return categoryRepository.findAllAndCountPublic({
    where,
    sort: { field: "sortOrder", order: SortOrder.ASC },
    query: rest,
  });
}
