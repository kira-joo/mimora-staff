import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { categoryRepository, productRepository, promotionRepository, storefrontContentRepository } from "../../core/repositories";
import { collectReferences } from "../../content/resolve-storefront-content";
import type { StorefrontContentSchema } from "../../content/storefront-content.schema";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { touchCategory } from "./category-hierarchy";
import { destroyImagesOnCommit, removedPublicIds } from "../media/image-cleanup";

/**
 * Deletes a category — only one nothing depends on. Deleting never moves anything: a category that still has
 * sub-categories or products (any lifecycle — an archived product still names its category, and `categoryId` is
 * required), or that a promotion or the storefront content (draft or live) points at, is refused with every reason
 * at once, so the merchant fixes them in one pass. Unpublishing is the reversible alternative (`published: false`).
 *
 * In a transaction so the stored image is destroyed only once the delete has committed. The checks read inside the
 * same session, sequentially — one session runs no parallel operations.
 *
 * Concurrency: the transaction's FIRST act is to write the category document (`touchCategory`). The reference
 * checks below read other collections, and a read conflicts with nothing — so a product assigned (or a sub-category
 * created) into this category by a concurrent transaction would otherwise commit untouched and be left pointing
 * at a deleted category. Every writer that attaches something to a category touches that same document first
 * (product create/update, category create/move), so exactly one of the two transactions wins: either the delete
 * commits first and the assignment re-runs and is refused ("Category not found"), or the assignment commits first
 * and the delete re-runs and sees it. Under sustained contention the loser can run out of the toolkit's retry
 * budget and answer 503 — the data stays consistent either way.
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  await withTransaction(async (tx) => {
    // The loser of a conflict must still be standing when the winner commits, or its retry budget burns in milliseconds.
    await backOffBeforeRetry(tx.attempt);
    if (!(await touchCategory(categoryId))) throw new NotFoundError("Category not found");
    const category = await categoryRepository.findOne({ where: { _id: categoryId } });

    const reasons: string[] = [];
    const children = await categoryRepository.count({ where: { parentId: categoryId } });
    if (children > 0) reasons.push(`it has ${children} sub-categor${children === 1 ? "y" : "ies"}`);
    const products = await productRepository.count({ where: { categoryId } });
    if (products > 0) reasons.push(`${products} product${products === 1 ? " is" : "s are"} assigned to it`);
    const promotions = await promotionRepository.count({ where: { "conditions.categories": categoryId } });
    if (promotions > 0) reasons.push(`${promotions} promotion${promotions === 1 ? " is" : "s are"} limited to it`);
    const content: StorefrontContentSchema | null = await storefrontContentRepository.findOne({ where: {}, skipThrowError: true, lean: true });
    const linked = [content?.draft, content?.published].some((body) => body && collectReferences(body).some((reference) => reference.kind === "category" && reference.id.toString() === categoryId));
    if (linked) reasons.push("the storefront content links to it");

    if (reasons.length > 0) {
      throw new ConflictError(`This category can't be deleted: ${reasons.join("; ")}. Move or remove those first, or unpublish it instead.`);
    }

    await categoryRepository.delete({ where: { _id: categoryId } });
    destroyImagesOnCommit(tx, removedPublicIds(category.image, null));
    return tx.complete(undefined);
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}
