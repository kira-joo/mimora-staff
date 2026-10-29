import type { LocalizedString } from "@kira-joo/toolkit-common";

/** A problem, or a note, traced to the CSV line it came from. `row` is the 1-based physical line (the header is line 1). */
export interface ImportIssue {
  row: number;
  column?: string;
  /** The product slug / SKU involved, when known — so a list of issues reads without the file open. */
  slug?: string;
  sku?: string;
  message: string;
}

export type ImportProductStatus = "draft" | "published" | "archived";

/** One variant as staged. Money stays a string; nothing here is a float. A blank optional cell is absent, never `0`. */
export interface ImportVariantRow {
  line: number;
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  price: string;
  compareAtPrice?: string;
  costPrice?: string;
  /** The on-hand count the file asserts. New variant: opening stock (RECEIPT). Existing: the difference is applied as an ADJUSTMENT. Absent: stock untouched (new variants start at 0). */
  stock?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  unitOfMeasure?: "EACH" | "PACK" | "BOX";
  unitsPerSale?: number;
  /** `false` takes the variant off sale (discontinued); absent leaves it as it is (new variants are on sale). */
  active?: boolean;
}

/**
 * Axes and attributes are staged exactly as written: a name or label the file did not give is an empty object,
 * not a made-up default. Defaults ("the key", "the value itself") are applied when the product is built
 * (`buildAxes`/`buildAttributes`), so an update of an existing product can tell "not mentioned" from "set".
 */
export interface ImportAxis {
  key: string;
  name: Partial<LocalizedString>;
  values: Array<{ key: string; label: Partial<LocalizedString> }>;
}

export interface ImportAttribute {
  key: string;
  name: Partial<LocalizedString>;
  values: Array<{ key: string; value: Partial<LocalizedString> }>;
}

/** One product with its variants, as staged. Absent optional text means "the file said nothing" — on an existing product that leaves it as it is. */
export interface ImportProduct {
  /** The line of the product's first row. */
  line: number;
  slug: string;
  /** Per locale; a locale the file did not fill is absent. */
  name: Partial<LocalizedString>;
  description: Partial<LocalizedString>;
  categorySlug?: string;
  brandSlug?: string;
  status?: ImportProductStatus;
  /** Absent: an existing product keeps its axes. Present: the axes the variants' option values are checked against. */
  optionAxes?: ImportAxis[];
  attributes?: ImportAttribute[];
  variants: ImportVariantRow[];
}

export const MAX_IMPORT_VARIANT_ROWS = 500;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;

export interface ImportSummary {
  /** Data lines read (the header excluded). */
  lines: number;
  products: { create: number; update: number };
  variants: { create: number; update: number };
  /** Opening-stock receipts plus stock adjustments publishing would write. */
  stockMovements: { receipts: number; adjustments: number };
  errors: number;
  warnings: number;
}
