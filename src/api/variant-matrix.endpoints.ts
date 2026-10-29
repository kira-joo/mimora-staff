import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";
import type { Variant } from "./variants.endpoints";

/** One new variant of the matrix. `stock` is the opening count, recorded as a RECEIPT. Money is a decimal string. */
export interface BulkCreateVariantRow {
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  price: string;
  compareAtPrice?: string;
  costPrice?: string;
  stock: number;
}

/** One existing variant's inline edit. `null` clears compare-at or cost. There is no `stock`: it moves only through inventory adjustments. */
export interface BulkUpdateVariantRow {
  id: string;
  price?: string;
  compareAtPrice?: string | null;
  costPrice?: string | null;
  discontinued?: boolean;
}

const BULK = "/admin/variants/bulk";

/** Creates the chosen combinations, all or none. A refusal names every row and field (`rows.3.sku`). */
export const bulkCreateVariantsEndpoint: Endpoint<{ body: { productId: string; rows: BulkCreateVariantRow[] }; returnType: Variant[] }> = { url: BULK, methodType: MethodType.POST };

/** Applies inline edits, all or none. */
export const bulkUpdateVariantsEndpoint: Endpoint<{ body: { productId: string; rows: BulkUpdateVariantRow[] }; returnType: Variant[] }> = { url: BULK, methodType: MethodType.PUT };
