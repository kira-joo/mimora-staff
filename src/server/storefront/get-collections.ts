import { SortOrder } from "@kira-joo/toolkit-common";
import { collectionRepository } from "../core/repositories";
import type { CollectionSchema } from "../catalog/collection.schema";

export async function getCollections(): Promise<CollectionSchema[]> {
  return collectionRepository.findAll({ where: { published: true }, sort: { field: "sortOrder", order: SortOrder.ASC } });
}
