import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import type { LocalizedText } from "./brands.endpoints";

/** A collection holds no product list itself — a product names its collections (`collectionIds`). */
export interface Collection {
  _id: string;
  name: LocalizedText;
  description: LocalizedText;
  slug: string;
  sortOrder: number;
  image?: ImageAsset | null;
  icon?: ImageAsset | null;
  seoTitle: LocalizedText;
  seoDescription: LocalizedText;
  published: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** `image` and `icon` are assets from the collection image upload. On update, `null` removes one; omitting it leaves it as it was. */
export interface CollectionInput {
  name: LocalizedText;
  description: LocalizedText;
  slug: string;
  image?: ImageAsset | null;
  icon?: ImageAsset | null;
  seoTitle: LocalizedText;
  seoDescription: LocalizedText;
  published: boolean;
}

export interface ListCollectionsQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
  published?: boolean;
  [key: string]: unknown;
}

const COLLECTIONS = "/admin/collections";

export const listCollectionsEndpoint: Endpoint<{ query: ListCollectionsQuery; returnType: PaginatedResponse<Collection> }> = {
  url: COLLECTIONS,
  methodType: MethodType.GET,
};

export const getCollectionEndpoint: Endpoint<{ params: { id: string }; returnType: Collection }> = {
  url: `${COLLECTIONS}/:id`,
  methodType: MethodType.GET,
};

export const createCollectionEndpoint: Endpoint<{ body: CollectionInput; returnType: Collection }> = {
  url: COLLECTIONS,
  methodType: MethodType.POST,
};

export const updateCollectionEndpoint: Endpoint<{ params: { id: string }; body: Partial<CollectionInput>; returnType: Collection }> = {
  url: `${COLLECTIONS}/:id`,
  methodType: MethodType.PUT,
};

/** The API's DELETE unpublishes. */
export const unpublishCollectionEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = {
  url: `${COLLECTIONS}/:id`,
  methodType: MethodType.DELETE,
};

export const reorderCollectionsEndpoint: Endpoint<{ body: { items: Array<{ collectionId: string; sortOrder: number }> }; returnType: void }> = {
  url: `${COLLECTIONS}/reorder`,
  methodType: MethodType.PUT,
};
