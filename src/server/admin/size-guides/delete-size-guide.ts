import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { productRepository, sizeGuideRepository } from "../../core/repositories";

/**
 * Deletes a size guide — unless a product still points at it.
 *
 * `Product.sizeGuide` is a plain reference, so deleting the guide would leave
 * every product that uses it pointing at nothing: its "Size guide" link would
 * 404 on the storefront. Refused with a 409 that names how many products depend
 * on it, so the merchant knows what to detach first. Nothing is deleted on a
 * refusal. (A product assigned in the instant between the count and the delete
 * is not caught; the storefront already hides the link for a guide that no
 * longer resolves, so that window costs a missing link, never a broken page.)
 */
export async function deleteSizeGuide(sizeGuideId: string): Promise<void> {
  // 404 first for a guide that does not exist, rather than a misleading "0 products".
  await sizeGuideRepository.findOne({ where: { _id: sizeGuideId } });

  const productCount = await productRepository.count({ where: { sizeGuide: sizeGuideId } });
  if (productCount > 0) {
    throw new ConflictError(`This size guide is used by ${productCount} ${productCount === 1 ? "product" : "products"}. Remove it from ${productCount === 1 ? "that product" : "those products"} before deleting it.`, { productCount });
  }

  await sizeGuideRepository.delete({ where: { _id: sizeGuideId } });
}
