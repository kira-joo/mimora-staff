import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { categoryRepository } from "../../core/repositories";
import type { CategorySchema } from "../../catalog/category.schema";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { MAX_CATEGORY_DEPTH, loadAncestry, subtreeHeight, touchCategories } from "./category-hierarchy";
import { destroyImagesOnCommit, removedPublicIds } from "../media/image-cleanup";

export interface UpdateCategoryInput {
  name?: LocalizedString;
  description?: LocalizedString;
  slug?: string;
  /** `null` moves the category to root; `undefined` leaves the parent untouched. */
  parentId?: string | null;
  sortOrder?: number;
  /** `null` removes the image (and destroys the stored asset once the write commits); `undefined` leaves it untouched. */
  image?: ImageAsset | null;
  seoTitle?: LocalizedString;
  seoDescription?: LocalizedString;
  published?: boolean;
}

/**
 * Hierarchy rules for one update, evaluated against the state read inside the transaction:
 *  - a category can't be its own parent, nor move under one of its own descendants (a cycle);
 *  - nesting stops at `MAX_CATEGORY_DEPTH`: the new parent's level plus the height of the moved subtree;
 *  - a published category needs a published parent, checked when it moves or becomes published;
 *  - a category with a published sub-category can't be unpublished (no cascade — the merchant unpublishes the
 *    children deliberately).
 * Depth and cycle are checked only when the parent actually changes, and the parent rule only on a move or a
 * publish, so editing a name on legacy data that predates a rule is never refused for something it didn't touch.
 *
 * Returns the ancestor chain the write depends on (empty when it depends on none) so the caller can touch it.
 */
async function assertHierarchyRules(category: CategorySchema, input: UpdateCategoryInput): Promise<CategorySchema[]> {
  const categoryId = category._id.toString();
  const currentParentId = category.parentId?.toString();
  const targetParentId = input.parentId === undefined ? currentParentId : (input.parentId ?? undefined);
  const parentChanges = input.parentId !== undefined && targetParentId !== currentParentId;
  const willBePublished = input.published ?? category.published;
  const becomesPublished = willBePublished && !category.published;

  if (input.parentId && input.parentId === categoryId) {
    throw new ConflictError("A category cannot be its own parent");
  }

  if (category.published && input.published === false) {
    const publishedChildren = await categoryRepository.count({ where: { parentId: categoryId, published: true } });
    if (publishedChildren > 0) {
      throw new ConflictError(
        `This category can't be unpublished: ${publishedChildren} of its sub-categor${publishedChildren === 1 ? "y is" : "ies are"} still published. Unpublish ${publishedChildren === 1 ? "it" : "them"} first.`
      );
    }
  }

  if (!targetParentId || !(parentChanges || becomesPublished)) return [];

  const ancestry = await loadAncestry(targetParentId);
  const parent = ancestry[0];
  if (!parent) {
    throw new NotFoundError("Parent category not found");
  }

  if (parentChanges) {
    // The proposed parent's own ancestor chain — a category can be moved anywhere except under itself or one of its descendants.
    if (ancestry.some((ancestor) => ancestor._id.toString() === categoryId)) {
      throw new ConflictError("A category cannot be moved under itself or one of its own descendants");
    }
    const height = await subtreeHeight(categoryId);
    if (ancestry.length + height > MAX_CATEGORY_DEPTH) {
      throw new ConflictError(
        `Categories can be nested at most ${MAX_CATEGORY_DEPTH} levels deep. Moving this category${height > 1 ? ` and its sub-categories (${height} levels)` : ""} under a parent at level ${ancestry.length} would reach level ${ancestry.length + height}.`
      );
    }
  }

  if (willBePublished && !parent.published) {
    throw new ConflictError(
      parentChanges
        ? "A published category can't be moved under an unpublished parent. Publish the parent first, or unpublish this category."
        : "A category can't be published while its parent is unpublished. Publish the parent first."
    );
  }

  return ancestry as CategorySchema[];
}

export async function updateCategory(categoryId: string, input: UpdateCategoryInput): Promise<CategorySchema> {
  const setFields: Record<string, unknown> = {};
  const unsetFields: Record<string, ""> = {};

  if (input.name !== undefined) setFields.name = input.name;
  if (input.description !== undefined) setFields.description = input.description;
  if (input.slug !== undefined) setFields.slug = input.slug;
  if (input.parentId !== undefined) {
    if (input.parentId === null) unsetFields.parentId = "";
    else setFields.parentId = input.parentId;
  }
  if (input.sortOrder !== undefined) setFields.sortOrder = input.sortOrder;
  if (input.image !== undefined) {
    if (input.image === null) unsetFields.image = "";
    else setFields.image = input.image;
  }
  if (input.seoTitle !== undefined) setFields.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) setFields.seoDescription = input.seoDescription;
  if (input.published !== undefined) setFields.published = input.published;

  /*
   * One transaction holds the checks and the write, so they see one snapshot — and it is what lets the replaced
   * image be destroyed only once the write has committed (`onCommit`), never before and never on a rollback.
   *
   * Concurrency: the hierarchy checks read other categories, and a read conflicts with nothing. So the write also
   * touches the new parent's whole ancestor chain (`touchCategory`). Two concurrent moves that would together
   * form a cycle (A under B while B under A — or any longer loop) each write one category and touch the other
   * one's chain, so they share a document and one of them conflicts, re-runs, and then sees the other's result
   * and is refused by the cycle check. The same touch makes a publish or a move conflict with a concurrent
   * unpublish of the parent, and — because the moved category itself is written — with a concurrent
   * create/move under it.
   */
  return withTransaction(async (tx) => {
    // The loser of a conflict must still be standing when the winner commits, or its retry budget burns in milliseconds.
    await backOffBeforeRetry(tx.attempt);
    const category = await categoryRepository.findOne({ where: { _id: categoryId } });

    if (input.slug && input.slug !== category.slug) {
      const existing = await categoryRepository.findOne({
        where: { slug: input.slug, _id: { $ne: categoryId } },
        skipThrowError: true,
      });
      if (existing) {
        throw new ConflictError("Category slug already exists");
      }
    }

    await touchCategories(await assertHierarchyRules(category, input));

    const updated = await categoryRepository.updateAtomic(
      { _id: categoryId },
      { $set: setFields, ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}) }
    );
    destroyImagesOnCommit(tx, removedPublicIds(category.image, input.image));
    return tx.complete(updated);
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}
