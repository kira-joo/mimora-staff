import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import type { LocalizedText } from "./brands.endpoints";

export interface Category {
  _id: string;
  name: LocalizedText;
  description: LocalizedText;
  slug: string;
  parentId?: string | null;
  sortOrder: number;
  image?: ImageAsset | null;
  seoTitle: LocalizedText;
  seoDescription: LocalizedText;
  published: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** `image` is an asset from the category image upload. On update, `null` removes it; omitting it leaves it as it was. */
export interface CategoryInput {
  name: LocalizedText;
  description: LocalizedText;
  slug: string;
  /** On update, `null` moves the category to the top level; omitting it leaves the parent as it was. */
  parentId?: string | null;
  image?: ImageAsset | null;
  seoTitle: LocalizedText;
  seoDescription: LocalizedText;
  published: boolean;
}

export interface ListCategoriesQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  parentId?: string;
  published?: boolean;
  ids?: string[];
  [key: string]: unknown;
}

const CATEGORIES = "/admin/categories";

export const listCategoriesEndpoint: Endpoint<{ query: ListCategoriesQuery; returnType: PaginatedResponse<Category> }> = {
  url: CATEGORIES,
  methodType: MethodType.GET,
};

export const getCategoryEndpoint: Endpoint<{ params: { id: string }; returnType: Category }> = {
  url: `${CATEGORIES}/:id`,
  methodType: MethodType.GET,
};

export const createCategoryEndpoint: Endpoint<{ body: CategoryInput; returnType: Category }> = {
  url: CATEGORIES,
  methodType: MethodType.POST,
};

export const updateCategoryEndpoint: Endpoint<{ params: { id: string }; body: Partial<CategoryInput>; returnType: Category }> = {
  url: `${CATEGORIES}/:id`,
  methodType: MethodType.PUT,
};

/**
 * Deletes a category nothing depends on. The API refuses (409, naming every reason) while it has sub-categories or
 * products, or a promotion or the storefront content points at it — nothing is ever moved. Unpublishing is
 * `updateCategoryEndpoint` with `{ published: false }`.
 */
export const deleteCategoryEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = {
  url: `${CATEGORIES}/:id`,
  methodType: MethodType.DELETE,
};

export const reorderCategoriesEndpoint: Endpoint<{ body: { items: Array<{ categoryId: string; sortOrder: number }> }; returnType: void }> = {
  url: `${CATEGORIES}/reorder`,
  methodType: MethodType.PUT,
};
