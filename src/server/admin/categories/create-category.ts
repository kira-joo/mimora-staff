import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { categoryRepository } from "../../core/repositories";
import type { CategorySchema } from "../../catalog/category.schema";

export interface CreateCategoryInput {
  name: LocalizedString;
  description: LocalizedString;
  slug: string;
  parentId?: string;
  sortOrder?: number;
  image?: ImageAsset;
  seoTitle: LocalizedString;
  seoDescription: LocalizedString;
  published?: boolean;
}

export async function createCategory(input: CreateCategoryInput): Promise<CategorySchema> {
  const existing = await categoryRepository.findOne({ where: { slug: input.slug }, skipThrowError: true });
  if (existing) {
    throw new ConflictError("Category slug already exists");
  }

  if (input.parentId) {
    const parent = await categoryRepository.findOne({ where: { _id: input.parentId }, skipThrowError: true });
    if (!parent) {
      throw new NotFoundError("Parent category not found");
    }
  }

  return categoryRepository.save({
    name: input.name,
    description: input.description,
    slug: input.slug,
    parentId: input.parentId,
    sortOrder: input.sortOrder ?? 0,
    image: input.image,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    published: input.published ?? false,
  });
}
