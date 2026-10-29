import type { Types } from "mongoose";
import { variantRepository } from "../../core/repositories";

/**
 * Removes the given assets from every gallery override of the product's variants, inside the caller's
 * transaction. Sequential, not parallel: one session cannot run concurrent operations.
 */
export async function stripImagesFromVariantGalleries(productId: Types.ObjectId, publicIds: readonly string[]): Promise<void> {
  const removed = new Set(publicIds);
  const variants = await variantRepository.findAll({ where: { productId, "galleryOverride.publicId": { $in: [...removed] } } });

  for (const variant of variants) {
    await variantRepository.update(
      { where: { _id: variant._id } },
      { galleryOverride: (variant.galleryOverride ?? []).filter((image) => !removed.has(image.publicId)) }
    );
  }
}
