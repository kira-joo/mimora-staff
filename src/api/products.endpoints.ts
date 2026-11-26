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

/** A product's place in a product group (`product.group`): which group, what it is called there, its position. */
export interface ProductGroupMembership {
  groupId: string;
  label: LocalizedText;
  order: number;
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
  group?: ProductGroupMembership;
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
  /** Set only through the product-group endpoints. */
  group?: ProductGroupMembership;
  listing: { minActivePrice?: string; maxActivePrice?: string; purchasableVariantCount: number };
  updatedAt?: string;
}

/** `images` is not a form field: the product page holds the gallery, and an edit sends it (from "Save images", or with "Save product" when it changed) through `updateProductEndpoint`. `lifecycle` changes through its own endpoint. */
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

/** How the products list is ordered (`sort` on `GET /admin/products`). `manual` is the arranged order and the default. */
export type ProductListSort = "manual" | "newest" | "oldest" | "price_asc" | "price_desc";

export const PRODUCT_SORT_OPTIONS: Array<{ value: ProductListSort; label: string }> = [
  { value: "manual", label: "Manual order" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

export interface ListProductsQuery {
  page?: number;
  limit?: number;
  search?: string;
  sort?: ProductListSort;
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

/** What the arrange screen shows of one product (`GET /admin/products/order`): a light projection, never the whole document. */
export interface ArrangeProduct {
  _id: string;
  name: LocalizedText;
  slug: string;
  lifecycle: ProductLifecycle;
  categoryId: string;
  listing: { primaryImage?: ImageAsset };
}

/** At most one of the two. A category includes all its sub-categories; neither means the whole catalogue. */
export type ProductOrderScope = {
  categoryId?: string;
  collectionId?: string;
};

/** Every non-archived product in the scope, in its manual order, unpaginated. */
export const listProductOrderEndpoint: Endpoint<{ query: ProductOrderScope; returnType: ArrangeProduct[] }> = {
  url: `${PRODUCTS}/order`,
  methodType: MethodType.GET,
};

/** Saves the scope's complete list in its new order. A 409 means the list changed since it was loaded. */
export const saveProductOrderEndpoint: Endpoint<{ body: ProductOrderScope & { productIds: string[] }; returnType: { updated: number } }> = {
  url: `${PRODUCTS}/order`,
  methodType: MethodType.PUT,
};
