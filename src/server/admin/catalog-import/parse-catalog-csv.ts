import { IMPORT_COLUMNS, PRODUCT_LEVEL_COLUMNS, REQUIRED_IMPORT_COLUMNS, normalizeHeader, type ImportColumn } from "./import-columns";
import { CsvSyntaxError, parseCsv } from "./csv";
import { MAX_IMPORT_VARIANT_ROWS, type ImportAttribute, type ImportAxis, type ImportIssue, type ImportProduct, type ImportProductStatus, type ImportVariantRow } from "./import-types";

/** The file cannot be read as a catalog at all — no batch is staged, the person fixes the file and uploads again. */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

export interface ParsedCatalogCsv {
  products: ImportProduct[];
  /** Data lines read. */
  lines: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

const SLUG = /^[^\s/?#%]{1,200}$/;
const AXIS_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const WHOLE = /^\d+$/;
const MEASURE = /^\d+(\.\d+)?$/;
/** Characters the variant key and the cell sub-formats use as separators; a value containing one could not be read back. */
const RESERVED = /[|=;]/;
const STATUSES: readonly ImportProductStatus[] = ["draft", "published", "archived"];
const UNITS = ["EACH", "PACK", "BOX"] as const;

const list = (cell: string): string[] => cell.split(";").map((part) => part.trim()).filter(Boolean);
const parts = (entry: string): string[] => entry.split("|").map((part) => part.trim());
const text = (value: string | undefined) => (value === undefined || value === "" ? undefined : value);
const localized = (en: string | undefined, ar: string | undefined) => ({ ...(text(en) ? { en: en! } : {}), ...(text(ar) ? { ar: ar! } : {}) });

/**
 * Reads a catalog CSV into staged products and every problem found in the FILE ITSELF — format, references
 * between its own rows, duplicates within it. Pure: nothing here knows the database. Whether a category
 * exists, whether a SKU is taken by another product, whether a product is new or an update, are
 * `planCatalogImport`'s questions.
 *
 * Row problems do not stop the parse: every row is checked so the person sees all of them at once.
 * Only a file that cannot be read as a catalog at all (no header, a required column missing, unclosed
 * quote, too many rows) throws `ImportFileError`.
 */
export function parseCatalogCsv(content: string): ParsedCatalogCsv {
  let records;
  try {
    records = parseCsv(content);
  } catch (error) {
    if (error instanceof CsvSyntaxError) throw new ImportFileError(`Line ${error.line}: ${error.message}`);
    throw error;
  }
  if (records.length === 0) throw new ImportFileError("The file is empty. The first line must be the column headers.");

  const [headerRecord, ...dataRecords] = records;
  const header = headerRecord!.cells.map(normalizeHeader);
  const index = new Map<ImportColumn, number>();
  const warnings: ImportIssue[] = [];
  const known = new Set<string>(IMPORT_COLUMNS);
  header.forEach((name, position) => {
    if (known.has(name)) {
      if (index.has(name as ImportColumn)) warnings.push({ row: 1, column: name, message: `Column "${name}" appears twice — the first one is used.` });
      else index.set(name as ImportColumn, position);
    } else if (name) {
      warnings.push({ row: 1, column: name, message: `Unknown column "${name}" — ignored.` });
    }
  });

  const missing = REQUIRED_IMPORT_COLUMNS.filter((column) => !index.has(column));
  if (missing.length > 0) {
    const hint = header.length === 1 && /[;\t]/.test(headerRecord!.cells[0]!) ? " This looks like a semicolon- or tab-delimited file: save it as \"CSV UTF-8 (Comma delimited)\"." : "";
    throw new ImportFileError(`Required column${missing.length > 1 ? "s" : ""} missing from the header: ${missing.join(", ")}.${hint}`);
  }
  if (dataRecords.length === 0) throw new ImportFileError("The file has a header but no rows.");
  if (dataRecords.length > MAX_IMPORT_VARIANT_ROWS) {
    throw new ImportFileError(`The file has ${dataRecords.length} rows; one import takes at most ${MAX_IMPORT_VARIANT_ROWS}. Split it into several files.`);
  }

  const errors: ImportIssue[] = [];
  const productsBySlug = new Map<string, ImportProduct>();
  const productCells = new Map<string, Map<ImportColumn, { value: string; line: number }>>();
  const rawAxes = new Map<string, string>();
  const seenSkus = new Map<string, number>();

  for (const record of dataRecords) {
    const line = record.line;
    const cell = (column: ImportColumn): string | undefined => {
      const position = index.get(column);
      return position === undefined ? undefined : text(record.cells[position]?.trim());
    };
    const issue = (column: ImportColumn | undefined, message: string, extra: Partial<ImportIssue> = {}) => errors.push({ row: line, ...(column ? { column } : {}), message, ...extra });

    if (record.cells.length > header.length) {
      issue(undefined, `This row has ${record.cells.length} cells but the header has ${header.length} — a comma inside a value needs the value in double quotes.`);
    }

    const slug = cell("product_slug");
    if (!slug) {
      issue("product_slug", "product_slug is required.");
      continue;
    }
    if (!SLUG.test(slug)) {
      issue("product_slug", "product_slug must be 1–200 characters with no spaces and none of / ? # %.", { slug });
      continue;
    }

    let product = productsBySlug.get(slug);
    if (!product) {
      product = { line, slug, name: {}, description: {}, variants: [] };
      productsBySlug.set(slug, product);
      productCells.set(slug, new Map());
    }

    // Product-level cells: the first non-blank value wins; a later, different one is a conflict, not a silent override.
    const firsts = productCells.get(slug)!;
    for (const column of PRODUCT_LEVEL_COLUMNS) {
      const value = cell(column);
      if (value === undefined) continue;
      const first = firsts.get(column);
      if (!first) firsts.set(column, { value, line });
      else if (first.value !== value) issue(column, `${column} differs from line ${first.line}. It describes the product, so every row of "${slug}" must agree (or leave it blank).`, { slug });
    }

    const sku = cell("sku");
    const variant: Partial<ImportVariantRow> & { line: number } = { line };
    if (!sku) issue("sku", "sku is required.", { slug });
    else if (sku.length > 100) issue("sku", "sku is longer than 100 characters.", { slug, sku });
    else {
      const first = seenSkus.get(sku);
      if (first !== undefined) issue("sku", `sku "${sku}" is repeated (first on line ${first}).`, { slug, sku });
      else seenSkus.set(sku, line);
      variant.sku = sku;
    }

    const money = (column: "price" | "compare_at_price" | "cost", required: boolean): string | undefined => {
      const value = cell(column);
      if (value === undefined) {
        if (required) issue(column, `${column} is required.`, { slug, ...(sku ? { sku } : {}) });
        return undefined;
      }
      if (!MONEY.test(value)) issue(column, `${column} "${value}" is not an amount. Use digits with up to two decimals, e.g. 100 or 99.50 — no currency symbol, no thousands separator.`, { slug, ...(sku ? { sku } : {}) });
      else return value;
      return undefined;
    };
    variant.price = money("price", true);
    variant.compareAtPrice = money("compare_at_price", false);
    variant.costPrice = money("cost", false);

    const number = (column: ImportColumn, pattern: RegExp, hint: string): number | undefined => {
      const value = cell(column);
      if (value === undefined) return undefined;
      if (!pattern.test(value)) {
        issue(column, `${column} "${value}" is not valid — ${hint}.`, { slug, ...(sku ? { sku } : {}) });
        return undefined;
      }
      return Number(value);
    };
    variant.stock = number("stock", WHOLE, "use a whole number, 0 or more");
    variant.weight = number("weight_g", MEASURE, "use a number of grams, e.g. 250 or 12.5");
    variant.length = number("length_mm", MEASURE, "use a number of millimetres");
    variant.width = number("width_mm", MEASURE, "use a number of millimetres");
    variant.height = number("height_mm", MEASURE, "use a number of millimetres");
    const units = number("units_per_sale", WHOLE, "use a whole number, 1 or more");
    if (units !== undefined && units < 1) issue("units_per_sale", "units_per_sale must be at least 1.", { slug, ...(sku ? { sku } : {}) });
    else variant.unitsPerSale = units;

    const uom = cell("unit_of_measure")?.toUpperCase();
    if (uom !== undefined) {
      if ((UNITS as readonly string[]).includes(uom)) variant.unitOfMeasure = uom as ImportVariantRow["unitOfMeasure"];
      else issue("unit_of_measure", `unit_of_measure "${uom}" is not one of ${UNITS.join(", ")}.`, { slug, ...(sku ? { sku } : {}) });
    }

    const active = cell("active")?.toLowerCase();
    if (active !== undefined) {
      if (["true", "yes", "1"].includes(active)) variant.active = true;
      else if (["false", "no", "0"].includes(active)) variant.active = false;
      else issue("active", `active "${active}" is not yes/no (or true/false, 1/0).`, { slug, ...(sku ? { sku } : {}) });
    }

    const optionValues: Array<{ key: string; value: string }> = [];
    for (const entry of list(cell("option_values") ?? "")) {
      const at = entry.indexOf("=");
      const key = at < 0 ? "" : entry.slice(0, at).trim();
      const value = at < 0 ? "" : entry.slice(at + 1).trim();
      if (!key || !value) issue("option_values", `option_values entry "${entry}" must look like colour=red.`, { slug, ...(sku ? { sku } : {}) });
      else if (!AXIS_KEY.test(key)) issue("option_values", `Option key "${key}" may use letters, digits, "-" and "_" only (up to 50).`, { slug, ...(sku ? { sku } : {}) });
      else if (RESERVED.test(value) || value.length > 200) issue("option_values", `Option value "${value}" may not contain | = ; and may be at most 200 characters.`, { slug, ...(sku ? { sku } : {}) });
      else if (optionValues.some((existing) => existing.key === key)) issue("option_values", `Option "${key}" is given twice.`, { slug, ...(sku ? { sku } : {}) });
      else optionValues.push({ key, value });
    }
    variant.optionValues = optionValues;

    product.variants.push(variant as ImportVariantRow);
  }

  // ---- Per product: product-level columns, axes, attributes, and the consistency of its variants -------------------
  for (const product of productsBySlug.values()) {
    const cells = productCells.get(product.slug)!;
    const get = (column: ImportColumn) => cells.get(column)?.value;
    const at = (column: ImportColumn) => cells.get(column)?.line ?? product.line;
    const problem = (column: ImportColumn | undefined, row: number, message: string) => errors.push({ row, ...(column ? { column } : {}), slug: product.slug, message });

    product.name = localized(get("name_en"), get("name_ar"));
    product.description = localized(get("description_en"), get("description_ar"));
    product.categorySlug = get("category_slug");
    product.brandSlug = get("brand_slug");

    const status = get("status")?.toLowerCase();
    if (status !== undefined) {
      if ((STATUSES as readonly string[]).includes(status)) product.status = status as ImportProductStatus;
      else problem("status", at("status"), `status "${status}" is not one of ${STATUSES.join(", ")}.`);
    }

    // Axes: as written in option_axes, else the keys the variants' option_values use, in the order they first appear.
    const axes: ImportAxis[] = [];
    const givenAxes = get("option_axes");
    for (const entry of list(givenAxes ?? "")) {
      const [key = "", en, ar] = parts(entry);
      if (!AXIS_KEY.test(key)) problem("option_axes", at("option_axes"), `Option "${key}" needs a key of letters, digits, "-" or "_" (up to 50): key|English name|Arabic name.`);
      else if (axes.some((axis) => axis.key === key)) problem("option_axes", at("option_axes"), `Option "${key}" is listed twice.`);
      else axes.push({ key, name: localized(en, ar), values: [] });
    }
    if (givenAxes === undefined) {
      for (const variant of product.variants)
        for (const { key } of variant.optionValues) if (!axes.some((axis) => axis.key === key)) axes.push({ key, name: {}, values: [] });
    }

    // Every variant must carry exactly one value per axis. A product with no axes has one variant.
    const combinations = new Map<string, number>();
    for (const variant of product.variants) {
      // A row with no option values, in a file that did not declare the options, may be an existing variant being
      // re-priced (its options are already stored). Whether it is, is the planner's question — it knows the catalog.
      if (variant.optionValues.length === 0 && givenAxes === undefined) continue;
      const keys = new Set(variant.optionValues.map((option) => option.key));
      const missing = axes.filter((axis) => !keys.has(axis.key)).map((axis) => axis.key);
      const extra = [...keys].filter((key) => !axes.some((axis) => axis.key === key));
      if (missing.length > 0 || extra.length > 0) {
        const detail = [missing.length ? `missing ${missing.join(", ")}` : "", extra.length ? `not an option of this product: ${extra.join(", ")}` : ""].filter(Boolean).join("; ");
        errors.push({ row: variant.line, column: "option_values", slug: product.slug, sku: variant.sku, message: `option_values must give exactly one value per option (${detail}).` });
        continue;
      }
      const combination = [...variant.optionValues].sort((a, b) => a.key.localeCompare(b.key)).map((option) => `${option.key}=${option.value}`).join("|");
      const first = combinations.get(combination);
      if (first !== undefined) errors.push({ row: variant.line, column: "option_values", slug: product.slug, sku: variant.sku, message: `This option combination is already on line ${first} — one variant per combination.` });
      else combinations.set(combination, variant.line);
      for (const option of variant.optionValues) {
        const values = axes.find((axis) => axis.key === option.key)!.values;
        if (!values.some((value) => value.key === option.value)) values.push({ key: option.value, label: {} });
      }
    }

    // Labels for option values: `axis.value=English|Arabic`.
    for (const entry of list(get("option_value_labels") ?? "")) {
      const equals = entry.indexOf("=");
      const target = equals < 0 ? "" : entry.slice(0, equals).trim();
      const dot = target.indexOf(".");
      const axisKey = dot < 0 ? "" : target.slice(0, dot);
      const valueKey = dot < 0 ? "" : target.slice(dot + 1);
      const [en, ar] = equals < 0 ? [] : parts(entry.slice(equals + 1));
      const value = axes.find((axis) => axis.key === axisKey)?.values.find((candidate) => candidate.key === valueKey);
      if (!axisKey || !valueKey || (!en && !ar)) problem("option_value_labels", at("option_value_labels"), `option_value_labels entry "${entry}" must look like colour.red=Red|أحمر.`);
      else if (!value) problem("option_value_labels", at("option_value_labels"), `option_value_labels names "${target}", but no variant of this product has that option value.`);
      else value.label = localized(en, ar);
    }
    if (axes.length > 0) product.optionAxes = axes;

    // Attributes: `key=valueKey|English|Arabic` (repeat the key for several values), named by `key=English|Arabic`.
    const attributes: ImportAttribute[] = [];
    for (const entry of list(get("attributes") ?? "")) {
      const equals = entry.indexOf("=");
      const key = equals < 0 ? "" : entry.slice(0, equals).trim();
      const [valueKey = "", en, ar] = equals < 0 ? [] : parts(entry.slice(equals + 1));
      if (!AXIS_KEY.test(key) || !valueKey || RESERVED.test(valueKey)) {
        problem("attributes", at("attributes"), `attributes entry "${entry}" must look like material=cotton|Cotton|قطن (key, then value key, English, Arabic).`);
        continue;
      }
      let attribute = attributes.find((candidate) => candidate.key === key);
      if (!attribute) attributes.push((attribute = { key, name: {}, values: [] }));
      if (attribute.values.some((value) => value.key === valueKey)) problem("attributes", at("attributes"), `Attribute "${key}" lists value "${valueKey}" twice.`);
      else attribute.values.push({ key: valueKey, value: localized(en, ar) });
    }
    for (const entry of list(get("attribute_names") ?? "")) {
      const equals = entry.indexOf("=");
      const key = equals < 0 ? "" : entry.slice(0, equals).trim();
      const [en, ar] = equals < 0 ? [] : parts(entry.slice(equals + 1));
      const attribute = attributes.find((candidate) => candidate.key === key);
      if (!key || (!en && !ar)) problem("attribute_names", at("attribute_names"), `attribute_names entry "${entry}" must look like material=Material|الخامة.`);
      else if (!attribute) problem("attribute_names", at("attribute_names"), `attribute_names names "${key}", which the attributes column does not use.`);
      else attribute.name = localized(en, ar);
    }
    if (attributes.length > 0) product.attributes = attributes;
  }

  return { products: [...productsBySlug.values()], lines: dataRecords.length, errors, warnings };
}
