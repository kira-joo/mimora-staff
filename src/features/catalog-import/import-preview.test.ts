import { describe, expect, it } from "vitest";
import { parseCatalogCsv } from "src/server/admin/catalog-import/parse-catalog-csv";
import type { ImportProductRow, ImportSummary } from "src/api/catalog-imports.endpoints";
import { describeSummary, previewRows, templateCsv, unplacedIssues } from "./import-preview";

const products: ImportProductRow[] = [
  { line: 2, slug: "tee", name: { ar: "تي", en: "Tee" }, status: "draft", variants: [{ line: 2, sku: "T-S", optionValues: [{ key: "size", value: "s" }], price: "10", stock: 3 }, { line: 3, sku: "T-M", optionValues: [{ key: "size", value: "m" }], price: "10" }] },
  { line: 4, slug: "mug", name: { ar: "كوب" }, variants: [{ line: 4, sku: "M-1", optionValues: [], price: "5.50", stock: 0 }] },
];

describe("previewRows", () => {
  it("flattens products to one row per CSV line, in line order, with the issues that name each line", () => {
    const rows = previewRows(products, [{ row: 3, column: "price", message: "bad" }, { row: 3, message: "also bad" }, { row: 9, message: "elsewhere" }]);
    expect(rows.map((r) => [r.line, r.sku, r.options, r.stock])).toEqual([[2, "T-S", "size=s", "3"], [3, "T-M", "size=m", ""], [4, "M-1", "", "0"]]);
    expect(rows[1]?.issues).toHaveLength(2);
    expect(rows[0]?.issues).toEqual([]);
  });

  it("names an Arabic-only product by its Arabic name", () => {
    expect(previewRows(products, [])[2]?.name).toBe("كوب");
  });

  it("finds issues that point at no variant line, so none is hidden", () => {
    const issues = [{ row: 1, message: "header" }, { row: 3, message: "x" }];
    expect(unplacedIssues(previewRows(products, issues), issues)).toEqual([{ row: 1, message: "header" }]);
  });
});

describe("describeSummary", () => {
  const summary = (over: Partial<ImportSummary> = {}): ImportSummary => ({ lines: 4, products: { create: 1, update: 2 }, variants: { create: 3, update: 1 }, stockMovements: { receipts: 3, adjustments: 1 }, errors: 0, warnings: 0, ...over });
  it("says what publishing will do, singular and plural", () => {
    expect(describeSummary(summary())).toBe("1 new product, 2 products updated, 3 new variants, 1 variant updated, 3 opening-stock receipts and 1 stock adjustment");
  });
  it("leaves stock out when none moves", () => {
    expect(describeSummary(summary({ stockMovements: { receipts: 0, adjustments: 0 } }))).not.toMatch(/stock/);
  });
});

describe("templateCsv", () => {
  it("is a file the importer itself accepts, Arabic included", () => {
    const result = parseCatalogCsv(templateCsv());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.products[0]?.name).toEqual({ en: "Linen shirt", ar: "قميص كتان" });
    expect(result.products[0]?.variants[0]).toMatchObject({ sku: "LINEN-WHITE-M", price: "450", stock: 12 });
  });
  it("starts with a byte-order mark so Excel reads UTF-8", () => {
    expect(templateCsv().charCodeAt(0)).toBe(0xfeff);
  });
});
