import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { categoryRepository } from "../../core/repositories";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import type { CategorySchema } from "../../catalog/category.schema";
import { MAX_CATEGORY_DEPTH, loadAncestry, touchCategories } from "./category-hierarchy";

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

/**
 * Creates a category. Under a parent it enforces the hierarchy rules: nesting stops at `MAX_CATEGORY_DEPTH` levels,
 * and a category cannot be created published beneath an unpublished parent (a published child always has a
 * published parent).
 *
 * In a transaction that first writes the parent's whole ancestor chain (see `touchCategory`), so it conflicts with a
 * concurrent unpublish or delete of the parent, or a move of any ancestor, instead of racing past the checks.
 */
export async function createCategory(input: CreateCategoryInput): Promise<CategorySchema> {
  return withTransaction(async (tx) => {
    // The loser of a conflict must still be standing when the winner commits, or its retry budget burns in milliseconds.
    await backOffBeforeRetry(tx.attempt);
    const existing = await categoryRepository.findOne({ where: { slug: input.slug }, skipThrowError: true });
    if (existing) {
      throw new ConflictError("Category slug already exists");
    }

    if (input.parentId) {
      const ancestry = await loadAncestry(input.parentId);
      const parent = ancestry[0];
      if (!parent) {
        throw new NotFoundError("Parent category not found");
      }
      if (ancestry.length + 1 > MAX_CATEGORY_DEPTH) {
        throw new ConflictError(`Categories can be nested at most ${MAX_CATEGORY_DEPTH} levels deep. The parent is already at level ${ancestry.length}, so a sub-category can't be added under it.`);
      }
      if (input.published && !parent.published) {
        throw new ConflictError("A published category needs a published parent. Publish the parent first, or save this category unpublished.");
      }
      await touchCategories(ancestry);
    }

    const created = await categoryRepository.save({
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
    return tx.complete(created);
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}
