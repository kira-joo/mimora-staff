/**
 * The column contract of the catalog import. The authoritative description is `docs/catalog-import.md`; this
 * is the one place the code names the columns, so the parser, the template download and the documentation
 * test cannot drift apart.
 *
 * One row per VARIANT. Rows sharing a `product_slug` are one product.
 */
export const IMPORT_COLUMNS = [
  "product_slug",
  "name_en",
  "name_ar",
  "description_en",
  "description_ar",
  "category_slug",
  "brand_slug",
  "status",
  "option_axes",
  "option_value_labels",
  "attributes",
  "attribute_names",
  "sku",
  "option_values",
  "price",
  "compare_at_price",
  "cost",
  "stock",
  "weight_g",
  "length_mm",
  "width_mm",
  "height_mm",
  "unit_of_measure",
  "units_per_sale",
  "active",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Without these the file cannot describe a variant at all. Everything else is optional and a blank cell never erases existing data. */
export const REQUIRED_IMPORT_COLUMNS: readonly ImportColumn[] = ["product_slug", "sku", "price"];

/** Product-level columns: identical on every row of one product, or blank on the later rows. */
export const PRODUCT_LEVEL_COLUMNS: readonly ImportColumn[] = [
  "name_en",
  "name_ar",
  "description_en",
  "description_ar",
  "category_slug",
  "brand_slug",
  "status",
  "option_axes",
  "option_value_labels",
  "attributes",
  "attribute_names",
];

/** A header cell as a column name: trimmed, lower-cased, spaces and hyphens read as underscores. */
export function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** A header for the downloadable template — the contract itself, in order. */
export const IMPORT_TEMPLATE_HEADER = IMPORT_COLUMNS.join(",");
