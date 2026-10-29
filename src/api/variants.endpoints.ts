import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";

export type BackorderPolicy = "DENY" | "CONTINUE_SELLING";

export interface Variant {
  _id: string;
  productId: string;
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  /** Money: decimal strings in major units. */
  price: string;
  compareAtPrice?: string;
  costPrice?: string;
  stock: number;
  lowStockThreshold?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  unitOfMeasure: string;
  unitsPerSale: number;
  backorderPolicy: BackorderPolicy;
  discontinued: boolean;
  /** Images chosen from the product's gallery for this variant (a colour's own photographs). Empty: the product's gallery shows. */
  galleryOverride?: ImageAsset[];
}

export interface VariantInput {
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  price: string;
  compareAtPrice?: string;
  costPrice?: string;
  lowStockThreshold?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  unitOfMeasure?: string;
  unitsPerSale?: number;
  backorderPolicy?: BackorderPolicy;
}

/** Stock is set only when a variant is created; afterwards it moves through Inventory adjustments, which keep the movement record. */
export interface CreateVariantInput extends VariantInput {
  productId: string;
  stock: number;
}

export interface ListVariantsQuery {
  page?: number;
  limit?: number;
  productId?: string;
  discontinued?: boolean;
  [key: string]: unknown;
}

const VARIANTS = "/admin/variants";

export const listVariantsEndpoint: Endpoint<{ query: ListVariantsQuery; returnType: PaginatedResponse<Variant> }> = {
  url: VARIANTS,
  methodType: MethodType.GET,
};

export const createVariantEndpoint: Endpoint<{ body: CreateVariantInput; returnType: Variant }> = {
  url: VARIANTS,
  methodType: MethodType.POST,
};

export const updateVariantEndpoint: Endpoint<{ params: { id: string }; body: Partial<VariantInput> & { discontinued?: boolean; galleryOverride?: ImageAsset[] }; returnType: Variant }> = {
  url: `${VARIANTS}/:id`,
  methodType: MethodType.PUT,
};

/** A hard delete, for a variant made by mistake. Past orders keep their snapshot. */
export const deleteVariantEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = {
  url: `${VARIANTS}/:id`,
  methodType: MethodType.DELETE,
};
