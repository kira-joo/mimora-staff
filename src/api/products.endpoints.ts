import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import type { LocalizedText } from "./brands.endpoints";

export type ProductLifecycle = "draft" | "published" | "archived";

/** A selling dimension (size, colour). Each variant carries one value per axis, as free text. */
export interface OptionAxis {
  key: string;
  name: LocalizedText;
  /** The values this option offers, labelled for both languages. Optional: an option without them still works, the matrix grid just has nothing to lay out. */
  values?: OptionAxisValue[];
}

export interface OptionAxisValue {
  key: string;
  label: LocalizedText;
  /** `#RRGGBB`, display only. */
  swatch?: string;
}

/** A facet for browsing (material, fit) — distinct from option axes, which variants are built from. */
export interface ProductAttribute {
  key: string;
  name: LocalizedText;
  values: Array<{ key: string; value: LocalizedText }>;
}

/** `GET /admin/products` row (`ProductListView`). Prices are decimal strings. */
export interface ProductListItem {
  _id: string;
  name: LocalizedText;
  slug: string;
  categoryId: string;
  brandId?: string;
  lifecycle: ProductLifecycle;
  publishAt?: string;
  order: number;
  listing: { minActivePrice?: string; maxActivePrice?: string; purchasableVariantCount: number };
  createdAt?: string;
}

export interface Product {
  _id: string;
  name: LocalizedText;
  description: LocalizedText;
  slug: string;
  categoryId: string;
  collectionIds?: string[];
  brandId?: string | null;
  sizeGuide?: string | null;
  /** The gallery in display order; the first is the primary image. */
  images?: ImageAsset[];
  optionAxes: OptionAxis[];
  attributes: ProductAttribute[];
  seoTitle?: LocalizedText;
  seoDescription?: LocalizedText;
  lifecycle: ProductLifecycle;
  publishAt?: string;
  order: number;
  listing: { minActivePrice?: string; maxActivePrice?: string; purchasableVariantCount: number };
  updatedAt?: string;
}

/** `images` is managed by the product image manager (its own save), not by this form, so it is not part of this input. `lifecycle` changes through its own endpoint. */
export interface ProductInput {
  name: LocalizedText;
  description: LocalizedText;
  slug: string;
  categoryId: string;
  collectionIds: string[];
  /** `null` on update unlinks it. */
  brandId?: string | null;
  sizeGuide?: string | null;
  optionAxes: OptionAxis[];
  attributes: ProductAttribute[];
  seoTitle: LocalizedText;
  seoDescription: LocalizedText;
  publishAt?: string;
}

export interface ListProductsQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  categoryId?: string;
  brandId?: string;
  collectionId?: string;
  lifecycle?: ProductLifecycle;
  [key: string]: unknown;
}

const PRODUCTS = "/admin/products";

export const listProductsEndpoint: Endpoint<{ query: ListProductsQuery; returnType: PaginatedResponse<ProductListItem> }> = {
  url: PRODUCTS,
  methodType: MethodType.GET,
};

export const getProductEndpoint: Endpoint<{ params: { id: string }; returnType: Product }> = {
  url: `${PRODUCTS}/:id`,
  methodType: MethodType.GET,
};

/** A new product starts as a draft — the API's default; lifecycle then moves through its own endpoint. */
export const createProductEndpoint: Endpoint<{ body: ProductInput; returnType: Product }> = {
  url: PRODUCTS,
  methodType: MethodType.POST,
};

export const updateProductEndpoint: Endpoint<{ params: { id: string }; body: Partial<ProductInput> & { images?: ImageAsset[] }; returnType: Product }> = {
  url: `${PRODUCTS}/:id`,
  methodType: MethodType.PUT,
};

export const setProductLifecycleEndpoint: Endpoint<{ params: { id: string }; body: { lifecycle: ProductLifecycle }; returnType: Product }> = {
  url: `${PRODUCTS}/:id/lifecycle`,
  methodType: MethodType.PUT,
};
