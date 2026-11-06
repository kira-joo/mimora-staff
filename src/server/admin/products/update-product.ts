import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { productRepository, variantRepository } from "../../core/repositories";
import { axisKeysChanged } from "../../catalog/option-axis-keys";
import type { ProductSchema } from "../../catalog/product.schema";
import { assertProductPublishable } from "../../catalog/product-publishable";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { lockCategoryForAssignment } from "../categories/category-hierarchy";
import { maintainProductListingRollup } from "../../catalog/rollups/maintain-product-listing";
import { destroyImagesOnCommit, removedPublicIds } from "../media/image-cleanup";
import { stripImagesFromVariantGalleries } from "../media/strip-variant-galleries";

export interface UpdateProductInput {
  name?: LocalizedString;
  description?: LocalizedString;
  slug?: string;
  categoryId?: string;
  collectionIds?: string[];
  brandId?: string;
  sizeGuide?: string;
  images?: ImageAsset[];
  optionAxes?: Array<{ key: string; name: LocalizedString; values?: Array<{ key: string; label: LocalizedString; swatch?: string }> }>;
  attributes?: Array<{
    key: string;
    name: LocalizedString;
    values: Array<{ key: string; value: LocalizedString }>;
  }>;
  seoTitle?: LocalizedString;
  seoDescription?: LocalizedString;
  order?: number;
  publishAt?: Date;
}

/**
 * Option-axis keys are immutable once the product has variants (MDS §8, §13):
 * every variant stores one value per key, so adding, removing or renaming a
 * key would leave them inconsistent. Display names and order stay editable.
 * The refusal is a 409, never a silent change to the variants.
 *
 * In a transaction so it cannot race a variant being created: both write the
 * product document (variant creation maintains its listing rollup), so
 * whichever commits second conflicts, retries, and re-reads — the variant
 * count here, the axes in `createVariant`.
 */
export async function updateProduct(productId: string, input: UpdateProductInput): Promise<ProductSchema> {
  return withTransaction(async (tx) => {
    // The loser of a conflict must still be standing when the winner commits, or its retry budget burns in milliseconds.
    await backOffBeforeRetry(tx.attempt);
    const product = await productRepository.findOne({ where: { _id: productId }, lean: true });

    if (input.optionAxes !== undefined && axisKeysChanged(product.optionAxes, input.optionAxes)) {
      const variantCount = await variantRepository.count({ where: { productId } });
      if (variantCount > 0) {
        throw new ConflictError(
          `This product has ${variantCount} ${variantCount === 1 ? "variant" : "variants"}, so its option keys can't change. Rename an option's display name instead, or delete the variants first.`
        );
      }
    }

    if (input.slug && input.slug !== product.slug) {
      const existing = await productRepository.findOne({
        where: { slug: input.slug, _id: { $ne: productId } },
        skipThrowError: true,
      });
      if (existing) {
        throw new ConflictError("Product slug already exists");
      }
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.collectionIds !== undefined) patch.collectionIds = input.collectionIds;
    if (input.brandId !== undefined) patch.brandId = input.brandId;
    if (input.sizeGuide !== undefined) patch.sizeGuide = input.sizeGuide;
    if (input.images !== undefined) patch.images = input.images;
    if (input.optionAxes !== undefined) patch.optionAxes = input.optionAxes;
    if (input.attributes !== undefined) patch.attributes = input.attributes;
    if (input.seoTitle !== undefined) patch.seoTitle = input.seoTitle;
    if (input.seoDescription !== undefined) patch.seoDescription = input.seoDescription;
    if (input.order !== undefined) patch.order = input.order;
    if (input.publishAt !== undefined) patch.publishAt = input.publishAt;

    // D-11: a live product cannot be edited into one missing its default locale.
    if (product.lifecycle === "published") await assertProductPublishable({ ...product, ...patch });

    // Moving a product into a category is a reference to it: same lock as `createProduct` (see `lockCategoryForAssignment`).
    if (input.categoryId !== undefined && input.categoryId !== product.categoryId.toString()) await lockCategoryForAssignment(input.categoryId);

    let updated = await productRepository.update({ where: { _id: productId } }, patch);

    if (input.images !== undefined) {
      /*
       * A removed product image may also be a variant's gallery pick (the picker chooses from the product's
       * images). Taking it out of those galleries is part of the same write, so no variant is left pointing at a
       * file about to be destroyed; the listing's primary image is derived from the gallery, so it is recomputed.
       * The destroy itself waits for the commit — a failed edit must not already have deleted the picture it kept.
       */
      const removed = removedPublicIds(product.images, input.images);
      if (removed.length > 0) await stripImagesFromVariantGalleries(product._id, removed);
      await maintainProductListingRollup(product._id);
      destroyImagesOnCommit(tx, removed);
      updated = await productRepository.findOne({ where: { _id: productId } });
    }

    return tx.complete(updated);
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}
