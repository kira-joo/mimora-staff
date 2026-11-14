import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import type { LocalizedText } from "./brands.endpoints";
import type { ProductLifecycle } from "./products.endpoints";

/** One product inside a box, joined to its live record. */
export interface ProductContentItem {
  productId: string;
  name: LocalizedText;
  slug: string;
  lifecycle: ProductLifecycle;
  image?: ImageAsset;
  quantity: number;
}

/** `GET /admin/products/:id/contents` — in the order customers see them. */
export interface ProductContents {
  productId: string;
  items: ProductContentItem[];
}

export const MAX_CONTENT_ITEMS = 20;
export const MAX_CONTENT_QUANTITY = 99;

export const getProductContentsEndpoint: Endpoint<{ params: { id: string }; returnType: ProductContents }> = { url: "/admin/products/:id/contents", methodType: MethodType.GET };
/** Replaces the whole list. Included products are referenced, never copied. */
export const setProductContentsEndpoint: Endpoint<{ params: { id: string }; body: { items: Array<{ productId: string; quantity: number }> }; returnType: ProductContents }> = {
  url: "/admin/products/:id/contents",
  methodType: MethodType.PUT,
};
