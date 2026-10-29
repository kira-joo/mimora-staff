import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { collectionRepository } from "../../core/repositories";
import type { CollectionSchema } from "../../catalog/collection.schema";

export interface CreateCollectionInput {
  name: LocalizedString;
  description: LocalizedString;
  slug: string;
  sortOrder?: number;
  image?: ImageAsset;
  seoTitle: LocalizedString;
  seoDescription: LocalizedString;
  published?: boolean;
}

export async function createCollection(input: CreateCollectionInput): Promise<CollectionSchema> {
  const existing = await collectionRepository.findOne({ where: { slug: input.slug }, skipThrowError: true });
  if (existing) {
    throw new ConflictError("Collection slug already exists");
  }

  return collectionRepository.save({
    name: input.name,
    description: input.description,
    slug: input.slug,
    sortOrder: input.sortOrder ?? 0,
    image: input.image,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    published: input.published ?? false,
  });
}
