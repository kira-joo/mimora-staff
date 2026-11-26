import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { productRepository } from "../../core/repositories";
import { ProductModel } from "../../catalog/product.schema";
import type { ProductSchema } from "../../catalog/product.schema";
import { assertProductPublishable } from "../../catalog/product-publishable";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { lockCategoryForAssignment } from "../categories/category-hierarchy";
import { nextFreeSlug, slugFamilyPattern } from "../../catalog/product-slug";

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
}

export interface CreateProductOptions {
  /**
   * What a taken slug means. `"reject"` (the default) is a 409 — catalog import relies on it, since it matches rows
   * to existing products by slug and must never fork one. `"suffix"` saves under the next free `slug-2`, `slug-3`, …
   * instead; the console's create uses it, so a clone or a reused name never blocks on the slug.
   */
  onSlugTaken?: "reject" | "suffix";
}

/**
 * In a transaction that first writes the target category (`lockCategoryForAssignment`): the category must exist
 * (404 otherwise — `categoryId` is required and nothing else would catch a stale one) and the product must not
 * commit beside a concurrent `deleteCategory`, which writes the same document and so conflicts with this one.
 */
export async function createProduct(input: CreateProductInput, options: CreateProductOptions = {}): Promise<ProductSchema> {
  return withTransaction(async (tx) => {
    // The loser of a conflict must still be standing when the winner commits, or its retry budget burns in milliseconds.
    await backOffBeforeRetry(tx.attempt);
    let slug = input.slug;
    if (options.onSlugTaken === "suffix") {
      slug = await freeProductSlug(input.slug);
    } else if (await productRepository.findOne({ where: { slug }, skipThrowError: true })) {
      throw new ConflictError("Product slug already exists");
    }
    if (input.lifecycle === "published") await assertProductPublishable(input);
    await lockCategoryForAssignment(input.categoryId);

    const created = await productRepository.save({
      name: input.name,
      description: input.description,
      slug,
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
      order: await nextProductOrder(),
    });
    return tx.complete(created);
  }, { maxRetries: CONTENDED_MAX_RETRIES });
}

/**
 * A new product goes to the END of the manual order: one past the highest `order` held by any product (archived
 * included, since archived products keep their slot). Computed inside the create's transaction. Two concurrent creates
 * may read the same maximum and share a position; the canonical tie-break (newest first) keeps the order deterministic
 * and the next arrangement renumbers 1..N. `order` is never a caller's input — arranging is the only way to move one.
 */
async function nextProductOrder(): Promise<number> {
  const top = await ProductModel.findOne({}, { order: 1 }, { session: resolveSession() }).sort({ order: -1 }).lean();
  return Math.max(top?.order ?? 0, 0) + 1;
}

/** The requested slug, or the next free `slug-<n>`. The unique index still decides a race between two creates. */
async function freeProductSlug(slug: string): Promise<string> {
  const family = await productRepository.findAll({ where: { slug: { $regex: slugFamilyPattern(slug) } }, lean: true });
  return nextFreeSlug(slug, family.map((product) => product.slug));
}
