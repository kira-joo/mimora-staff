import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import type { LocalizedText } from "./brands.endpoints";
import type { ProductLifecycle } from "./products.endpoints";

/** `GET /admin/product-groups` row. */
export interface ProductGroupListItem {
  _id: string;
  name: LocalizedText;
  revision: number;
  memberCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductGroupMember {
  productId: string;
  name: LocalizedText;
  slug: string;
  lifecycle: ProductLifecycle;
  image?: ImageAsset;
  /** What the storefront calls this product among the group ("Brown", "بني"). */
  label: LocalizedText;
  order: number;
}

/** `GET /admin/product-groups/:id` — every member whatever its lifecycle, in group order. */
export interface ProductGroup {
  _id: string;
  name: LocalizedText;
  /** Send back as `expectedRevision` when saving the membership; a stale one is a 409. */
  revision: number;
  members: ProductGroupMember[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductGroupMemberInput {
  productId: string;
  label: LocalizedText;
}

export interface ListProductGroupsQuery {
  page?: number;
  limit?: number;
  [key: string]: unknown;
}

const GROUPS = "/admin/product-groups";

export const listProductGroupsEndpoint: Endpoint<{ query: ListProductGroupsQuery; returnType: PaginatedResponse<ProductGroupListItem> }> = { url: GROUPS, methodType: MethodType.GET };
export const getProductGroupEndpoint: Endpoint<{ params: { id: string }; returnType: ProductGroup }> = { url: `${GROUPS}/:id`, methodType: MethodType.GET };
export const createProductGroupEndpoint: Endpoint<{ body: { name: LocalizedText }; returnType: ProductGroup }> = { url: GROUPS, methodType: MethodType.POST };
export const renameProductGroupEndpoint: Endpoint<{ params: { id: string }; body: { name: LocalizedText }; returnType: ProductGroup }> = { url: `${GROUPS}/:id`, methodType: MethodType.PUT };
/** Replaces the whole membership, in order. Moving a product here takes it out of its previous group. */
export const setProductGroupMembersEndpoint: Endpoint<{ params: { id: string }; body: { expectedRevision: number; members: ProductGroupMemberInput[] }; returnType: ProductGroup }> = {
  url: `${GROUPS}/:id/members`,
  methodType: MethodType.PUT,
};
/** Deletes the group and ungroups its products; the products are kept. */
export const deleteProductGroupEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = { url: `${GROUPS}/:id`, methodType: MethodType.DELETE };
