import { SortOrder } from "@kira-joo/toolkit-common";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { collectionRepository } from "../../core/repositories";
import type { CollectionSchema } from "../../catalog/collection.schema";
import type { ListAdminCollectionsQueryDto } from "../dto/list-admin-collections-query.dto";

export async function listCollections(query: ListAdminCollectionsQueryDto): Promise<PaginatedResponse<CollectionSchema>> {
  const { published, ...rest } = query;
  const where: Record<string, unknown> = {};
  if (published !== undefined) where.published = published;

  return collectionRepository.findAllAndCountPublic({
    where,
    sort: { field: "sortOrder", order: SortOrder.ASC },
    query: rest,
  });
}
