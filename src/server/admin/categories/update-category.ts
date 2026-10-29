import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { categoryRepository } from "../../core/repositories";
import type { CategorySchema } from "../../catalog/category.schema";
import { destroyImagesOnCommit, removedPublicIds } from "../media/image-cleanup";

type MaybeCategory = CategorySchema | null;

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

/** Walks the proposed parent's own ancestor chain — a category can be moved anywhere except under itself or one of its own descendants. */
async function assertNoCycle(categoryId: string, proposedParentId: string): Promise<void> {
  let currentId: string | undefined = proposedParentId;
  const visited = new Set<string>();

  while (currentId) {
    if (currentId === categoryId) {
      throw new ConflictError("A category cannot be moved under itself or one of its own descendants");
    }
    if (visited.has(currentId)) break; // defensive: pre-existing corrupt chain, not this write's problem
    visited.add(currentId);

    const current: MaybeCategory = await categoryRepository.findOne({ where: { _id: currentId }, skipThrowError: true });
    if (!current) break;
    currentId = current.parentId?.toString();
  }
}

export async function updateCategory(categoryId: string, input: UpdateCategoryInput): Promise<CategorySchema> {
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

  if (input.parentId) {
    if (input.parentId === categoryId) {
      throw new ConflictError("A category cannot be its own parent");
    }
    const parent = await categoryRepository.findOne({ where: { _id: input.parentId }, skipThrowError: true });
    if (!parent) {
      throw new NotFoundError("Parent category not found");
    }
    await assertNoCycle(categoryId, input.parentId);
  }

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

  // A transaction even though one collection changes: it is what lets the replaced image be destroyed only
  // once the write has committed (`onCommit`), never before and never on a rollback.
  return withTransaction(async (tx) => {
    const updated = await categoryRepository.updateAtomic(
      { _id: categoryId },
      { $set: setFields, ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}) }
    );
    destroyImagesOnCommit(tx, removedPublicIds(category.image, input.image));
    return tx.complete(updated);
  });
}
