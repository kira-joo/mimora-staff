import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { categoryRepository, productRepository, promotionRepository, storefrontContentRepository } from "../../core/repositories";
import { collectReferences } from "../../content/resolve-storefront-content";
import type { StorefrontContentSchema } from "../../content/storefront-content.schema";
import { destroyImagesOnCommit, removedPublicIds } from "../media/image-cleanup";

/**
 * Deletes a category — only one nothing depends on. Deleting never moves anything: a category that still has
 * sub-categories or products (any lifecycle — an archived product still names its category, and `categoryId` is
 * required), or that a promotion or the storefront content (draft or live) points at, is refused with every reason
 * at once, so the merchant fixes them in one pass. Unpublishing is the reversible alternative (`published: false`).
 *
 * In a transaction so the stored image is destroyed only once the delete has committed. The checks read inside the
 * same session, sequentially — one session runs no parallel operations.
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  const category = await categoryRepository.findOne({ where: { _id: categoryId } });

  await withTransaction(async (tx) => {
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
  });
}
