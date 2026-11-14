import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";
import type { LocalizedText } from "./brands.endpoints";

/** One attribute as products already use it. Derived server-side from every product — there is no attribute collection. */
export interface AttributeCatalogEntry {
  key: string;
  name: LocalizedText;
  /** Distinct names products give this key, most used first. More than one means existing data disagrees with itself. */
  nameVariants: LocalizedText[];
  productCount: number;
  values: Array<{ key: string; value: LocalizedText; productCount: number }>;
}

/** `GET /admin/product-attributes` — requires Product.read. */
export const listProductAttributesEndpoint: Endpoint<{ returnType: { data: AttributeCatalogEntry[] } }> = { url: "/admin/product-attributes", methodType: MethodType.GET };
