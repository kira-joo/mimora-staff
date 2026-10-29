import { ConflictError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { productRepository } from "../../core/repositories";
import type { ProductSchema } from "../../catalog/product.schema";
import { assertProductPublishable } from "../../catalog/product-publishable";

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

export async function createProduct(input: CreateProductInput): Promise<ProductSchema> {
  const existing = await productRepository.findOne({ where: { slug: input.slug }, skipThrowError: true });
  if (existing) {
    throw new ConflictError("Product slug already exists");
  }
  if (input.lifecycle === "published") await assertProductPublishable(input);

  return productRepository.save({
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
}
