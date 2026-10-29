import type { ImportIssue, ImportProductRow, ImportSummary } from "src/api/catalog-imports.endpoints";
import { IMPORT_COLUMNS } from "src/server/admin/catalog-import/import-columns";

/** One variant line of the preview, with its product beside it and the problems that name its line. */
export interface PreviewRow {
  line: number;
  slug: string;
  name: string;
  status: string;
  sku: string;
  options: string;
  price: string;
  stock: string;
  issues: ImportIssue[];
}

const displayName = (name: ImportProductRow["name"]) => name.en || name.ar || "";

/** The staged products flattened to one row per CSV line, each carrying the errors and warnings for that line. */
export function previewRows(products: readonly ImportProductRow[], issues: readonly ImportIssue[]): PreviewRow[] {
  const byLine = new Map<number, ImportIssue[]>();
  for (const issue of issues) byLine.set(issue.row, [...(byLine.get(issue.row) ?? []), issue]);
  return products
    .flatMap((product) =>
      product.variants.map((variant) => ({
        line: variant.line,
        slug: product.slug,
        name: displayName(product.name),
        status: product.status ?? "",
        sku: variant.sku ?? "",
        options: (variant.optionValues ?? []).map((option) => `${option.key}=${option.value}`).join("; "),
        price: variant.price ?? "",
        stock: variant.stock === undefined ? "" : String(variant.stock),
        issues: byLine.get(variant.line) ?? [],
      }))
    )
    .sort((a, b) => a.line - b.line);
}

/** Issues that name no variant line (a header problem, a product-level note on its first line is still a line, so this is rare). */
export function unplacedIssues(rows: readonly PreviewRow[], issues: readonly ImportIssue[]): ImportIssue[] {
  const placed = new Set(rows.map((row) => row.line));
  return issues.filter((issue) => !placed.has(issue.row));
}

/** The one-line answer to "what will publishing do?". */
export function describeSummary(summary: ImportSummary): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    `${plural(summary.products.create, "new product")}`,
    `${plural(summary.products.update, "product")} updated`,
    `${plural(summary.variants.create, "new variant")}`,
    `${plural(summary.variants.update, "variant")} updated`,
  ];
  const stock = summary.stockMovements.receipts + summary.stockMovements.adjustments;
  if (stock > 0) parts.push(`${plural(summary.stockMovements.receipts, "opening-stock receipt")} and ${plural(summary.stockMovements.adjustments, "stock adjustment")}`);
  return parts.join(", ");
}

/**
 * The template a person downloads: the contract's header and one worked example. Prefixed with a byte-order mark so Excel
 * opens it as UTF-8 — without it Arabic in the example (and in anything they add) would be misread on a double-click.
 */
export function templateCsv(): string {
  const example: Record<string, string> = {
    product_slug: "linen-shirt",
    name_en: "Linen shirt",
    name_ar: "قميص كتان",
    description_en: "A light summer shirt.",
    description_ar: "قميص صيفي خفيف.",
    category_slug: "shirts",
    brand_slug: "",
    status: "draft",
    option_axes: "colour|Colour|اللون;size|Size|المقاس",
    option_value_labels: "colour.white=White|أبيض",
    attributes: "material=linen|Linen|كتان",
    attribute_names: "material=Material|الخامة",
    sku: "LINEN-WHITE-M",
    option_values: "colour=white;size=m",
    price: "450",
    compare_at_price: "500",
    cost: "200",
    stock: "12",
    weight_g: "300",
    length_mm: "",
    width_mm: "",
    height_mm: "",
    unit_of_measure: "EACH",
    units_per_sale: "1",
    active: "yes",
  };
  const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return `﻿${IMPORT_COLUMNS.join(",")}\n${IMPORT_COLUMNS.map((column) => quote(example[column] ?? "")).join(",")}\n`;
}
