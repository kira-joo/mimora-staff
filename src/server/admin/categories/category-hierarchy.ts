import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import type mongoose from "mongoose";
import { resolveSession, trackWrite } from "@kira-joo/backend-toolkit-mongoose";
import { CategoryModel, type CategorySchema } from "../../catalog/category.schema";
import { categoryRepository } from "../../core/repositories";

/** Root is level 1; a category at level 4 may not have sub-categories. */
export const MAX_CATEGORY_DEPTH = 4;

type CategoryNode = Pick<CategorySchema, "_id" | "parentId" | "published">;

/**
 * A category's ancestors, nearest first: `[parent, grandparent, …, root]`. Its length is therefore the parent's
 * own level (root = 1). Stops at a missing document or a repeated one — a pre-existing corrupt chain is not this
 * write's problem, and must not loop it. Reads inside the ambient transaction when there is one.
 */
export async function loadAncestry(parentId: string): Promise<CategoryNode[]> {
  const chain: CategoryNode[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = parentId;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const current: CategoryNode | null = await categoryRepository.findOne({ where: { _id: currentId }, skipThrowError: true, lean: true });
    if (!current) break;
    chain.push(current);
    currentId = current.parentId?.toString();
  }
  return chain;
}

/** Levels in the subtree rooted at `categoryId`, itself included: 1 for a leaf. Sequential, one query per level. */
export async function subtreeHeight(categoryId: string): Promise<number> {
  const seen = new Set<string>([categoryId]);
  let frontier = [categoryId];
  let height = 1;

  // Bounded by the depth limit plus slack for legacy data; a corrupt cycle is cut by `seen`.
  while (frontier.length > 0 && height <= MAX_CATEGORY_DEPTH * 2) {
    const children: CategoryNode[] = await categoryRepository.findAll({ where: { parentId: { $in: frontier } }, lean: true });
    frontier = children.map((child) => child._id.toString()).filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
    if (frontier.length > 0) height += 1;
  }
  return height;
}

/**
 * Writes the category document (bumps its version key, leaving `updatedAt` alone) and reports whether it exists.
 *
 * This is the conflict primitive for every rule that spans documents. MongoDB transactions detect write–write
 * conflicts per document, and nothing else: a read of a category, or a write to a *different* collection that
 * merely points at it, conflicts with nothing. So any operation whose correctness depends on a category staying
 * as it was read — a delete (no products or children appear), a product assignment (the category does not vanish),
 * a move (the ancestor chain does not change) — first *writes* the categories it depends on. Two such
 * transactions then share a written document, so one fails with a transient write conflict and re-runs against
 * the committed state of the other (or ends as a 503 after the toolkit's retry budget).
 *
 * Must be called inside `withTransaction` — outside one it would be a pointless plain write.
 */
export async function touchCategory(categoryId: string | mongoose.Types.ObjectId): Promise<boolean> {
  const result = await trackWrite(() => CategoryModel.updateOne({ _id: categoryId }, { $inc: { __v: 1 } }, { session: resolveSession(), timestamps: false }).exec());
  return result.matchedCount > 0;
}

/** Touches every category in order — sequential on purpose: one session runs no parallel operations. */
export async function touchCategories(categories: Array<Pick<CategoryNode, "_id">>): Promise<void> {
  for (const category of categories) await touchCategory(category._id);
}

/**
 * For anything that is about to point at a category (a product's `categoryId`): proves the category exists AND
 * writes it, so the reference can't commit alongside a concurrent `deleteCategory` — see `touchCategory`. Without
 * the write, an existence check is stale the instant it returns. Call inside `withTransaction`, right before the
 * write that stores the reference.
 */
export async function lockCategoryForAssignment(categoryId: string): Promise<void> {
  if (!(await touchCategory(categoryId))) throw new NotFoundError("Category not found");
}

/**
 * Writes every given category in ascending id order (deduplicated) and returns the ids that do not exist. Sorted so
 * concurrent writers that share categories take their locks in the same order — otherwise two of them can each hold
 * one the other wants and burn a retry on a needless write conflict. Sequential on purpose: one session runs no
 * parallel operations. Call inside `withTransaction`.
 */
export async function touchCategoriesInOrder(categoryIds: Iterable<string | mongoose.Types.ObjectId>): Promise<string[]> {
  const unique = [...new Set([...categoryIds].map((categoryId) => categoryId.toString()))].sort();
  const missing: string[] = [];
  for (const categoryId of unique) if (!(await touchCategory(categoryId))) missing.push(categoryId);
  return missing;
}

/**
 * `lockCategoryForAssignment` for a write that points at several categories at once (a promotion's category
 * conditions): every one must exist, and every one is written so none can be deleted before this commits. A write
 * that reports bad references per form field (the storefront content) uses `touchCategoriesInOrder` itself.
 */
export async function lockCategoriesForAssignment(categoryIds: Iterable<string | mongoose.Types.ObjectId>): Promise<void> {
  if ((await touchCategoriesInOrder(categoryIds)).length > 0) throw new NotFoundError("Category not found");
}
