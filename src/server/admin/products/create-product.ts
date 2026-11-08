import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { productRepository } from "../../core/repositories";
import type { ProductSchema } from "../../catalog/product.schema";
import { assertProductPublishable } from "../../catalog/product-publishable";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { lockCategoryForAssignment } from "../categories/category-hierarchy";

export interface CreateProductInput {
  name: LocalizedString;
  description: LocalizedString;
  slug: string;
  categoryId: string;
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
  lifecycle?: "draft" | "published" | "archived";
  publishAt?: Date;
  order?: number;
}

/**
 * In a transaction that first writes the target category (`lockCategoryForAssignment`): the category must exist
 * (404 otherwise — `categoryId` is required and nothing else would catch a stale one) and the product must not
 * commit beside a concurrent `deleteCategory`, which writes the same document and so conflicts with this one.
 */
export async function createProduct(input: CreateProductInput): Promise<ProductSchema> {
  return withTransaction(async (tx) => {
    // The loser of a conflict must still be standing when the winner commits, or its retry budget burns in milliseconds.
    await backOffBeforeRetry(tx.attempt);
    const existing = await productRepository.findOne({ where: { slug: input.slug }, skipThrowError: true });
    if (existing) {
      throw new ConflictError("Product slug already exists");
    }
    if (input.lifecycle === "published") await assertProductPublishable(input);
    await lockCategoryForAssignment(input.categoryId);

    const created = await productRepository.save({
      name: input.name,
      description: input.description,
      slug: input.slug,
      categoryId: input.categoryId,
      collectionIds: input.collectionIds ?? [],
      brandId: input.brandId,
      sizeGuide: input.sizeGuide,
      images: input.images ?? [],
      optionAxes: input.optionAxes ?? [],
      attributes: input.attributes ?? [],
      seoTitle: input.seoTitle ?? { ar: "", en: "" },
      seoDescription: input.seoDescription ?? { ar: "", en: "" },
      lifecycle: input.lifecycle ?? "draft",
      publishAt: input.publishAt,
      order: input.order ?? 0,
    });
    return tx.complete(created);
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}
