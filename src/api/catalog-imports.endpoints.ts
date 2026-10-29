import { MethodType, type Endpoint, type PaginatedResponse } from "@kira-joo/frontend-toolkit-core";

export type ImportBatchStatus = "STAGED" | "PUBLISHED" | "DISCARDED";

/** A problem (or a note) traced to the CSV line it came from; line 1 is the header. */
export interface ImportIssue {
  row: number;
  column?: string;
  slug?: string;
  sku?: string;
  message: string;
}

export interface ImportSummary {
  lines: number;
  products: { create: number; update: number };
  variants: { create: number; update: number };
  stockMovements: { receipts: number; adjustments: number };
  errors: number;
  warnings: number;
}

export interface ImportVariantRow {
  line: number;
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  price?: string;
  compareAtPrice?: string;
  costPrice?: string;
  stock?: number;
  active?: boolean;
}

export interface ImportProductRow {
  line: number;
  slug: string;
  name: { ar?: string; en?: string };
  categorySlug?: string;
  status?: "draft" | "published" | "archived";
  variants: ImportVariantRow[];
}

export interface ImportResult {
  products: { created: number; updated: number };
  variants: { created: number; updated: number };
  stockMovements: { receipts: number; adjustments: number };
}

/** The list view omits `rows`, `rowErrors` and `warnings`; `GET /:id` carries them. */
export interface CatalogImportBatch {
  _id: string;
  status: ImportBatchStatus;
  filename?: string;
  summary?: ImportSummary;
  rowErrors?: ImportIssue[];
  warnings?: ImportIssue[];
  rows?: ImportProductRow[];
  publishResult?: ImportResult;
  publishedAt?: string;
  createdAt?: string;
}

const IMPORTS = "/admin/catalog-imports";

export const listCatalogImportsEndpoint: Endpoint<{ query: { page?: number; limit?: number; status?: ImportBatchStatus; [key: string]: unknown }; returnType: PaginatedResponse<CatalogImportBatch> }> = { url: IMPORTS, methodType: MethodType.GET };

export const getCatalogImportEndpoint: Endpoint<{ params: { id: string }; returnType: CatalogImportBatch }> = { url: `${IMPORTS}/:id`, methodType: MethodType.GET };

/** Multipart, field `file`. Stages the batch — nothing goes live. */
export const stageCatalogImportEndpoint: Endpoint<{ body: Record<string, never>; returnType: CatalogImportBatch }> = { url: IMPORTS, methodType: MethodType.POST };

export const discardCatalogImportEndpoint: Endpoint<{ params: { id: string }; returnType: void }> = { url: `${IMPORTS}/:id`, methodType: MethodType.DELETE };

/** Applies the batch to the live catalog in one transaction, once. */
export const publishCatalogImportEndpoint: Endpoint<{ params: { id: string }; returnType: CatalogImportBatch }> = { url: `${IMPORTS}/:id/publish`, methodType: MethodType.PUT };

export interface RebuildListingsResult {
  processed: number;
  batches: number;
}

/** Recomputes every product's listing rollup from its variants (`Catalog.publish`). Idempotent. */
export const rebuildListingsEndpoint: Endpoint<{ returnType: RebuildListingsResult }> = { url: "/admin/catalog/rebuild-listings", methodType: MethodType.POST };
