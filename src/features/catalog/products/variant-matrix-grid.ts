import type { OptionAxis } from "src/api/products.endpoints";
import type { Variant } from "src/api/variants.endpoints";
import { isMoneyInput } from "src/common/format/money-input";
import { buildVariantKey } from "src/server/catalog/variant-key";

/**
 * The logic of the variant matrix grid, kept apart from the screen so it can be tested: which combinations a product's
 * options imply, which of them already exist (the matrix is SPARSE — a product need not offer every combination), what a
 * staff member's edits amount to, and the rows to send. Money stays a string throughout; nothing here parses it into a float.
 */

export interface MatrixAxis {
  key: string;
  label: string;
  values: Array<{ key: string; label: string }>;
}

const nameOf = (axis: OptionAxis) => axis.name.en || axis.name.ar || axis.key;
const valueLabel = (value: { key: string; label?: { en: string; ar: string } }) => value.label?.en || value.label?.ar || value.key;

/**
 * Each option's values: the ones the option lists, in its order, then any value an existing variant carries that the list
 * does not (older products have no list at all). An existing variant therefore always has a row, whatever the option says.
 */
export function matrixAxes(axes: readonly OptionAxis[], variants: ReadonlyArray<Pick<Variant, "optionValues">>): MatrixAxis[] {
  return axes.map((axis) => {
    const values = (axis.values ?? []).map((value) => ({ key: value.key, label: valueLabel(value) }));
    for (const variant of variants) {
      const used = variant.optionValues.find((option) => option.key === axis.key)?.value;
      if (used !== undefined && !values.some((value) => value.key === used)) values.push({ key: used, label: used });
    }
    return { key: axis.key, label: nameOf(axis), values };
  });
}

export interface Combination {
  /** The canonical identity of the combination — the same ordering the server's `variantKey` uses, so both sides agree. */
  id: string;
  optionValues: Array<{ key: string; value: string }>;
  /** "Olive · M" — the values' labels in the options' order. */
  label: string;
}

export const combinationId = (optionValues: ReadonlyArray<{ key: string; value: string }>): string => buildVariantKey("", [...optionValues]);

/** Every combination the options imply, in the options' order. No options, or an option with no values, imply none. */
export function generateCombinations(axes: readonly MatrixAxis[]): Combination[] {
  if (axes.length === 0 || axes.some((axis) => axis.values.length === 0)) return [];
  let rows: Array<Array<{ key: string; value: string; label: string }>> = [[]];
  for (const axis of axes) rows = rows.flatMap((row) => axis.values.map((value) => [...row, { key: axis.key, value: value.key, label: value.label }]));
  return rows.map((row) => {
    const optionValues = row.map(({ key, value }) => ({ key, value }));
    return { id: combinationId(optionValues), optionValues, label: row.map((entry) => entry.label).join(" · ") };
  });
}

/** The variants by the combination they occupy. */
export function indexByCombination<T extends Pick<Variant, "optionValues">>(variants: readonly T[]): Map<string, T> {
  return new Map(variants.map((variant) => [combinationId(variant.optionValues), variant]));
}

export interface CoverageSummary {
  total: number;
  existing: number;
  missing: number;
}

export function coverage(combinations: readonly Combination[], existing: ReadonlyMap<string, unknown>): CoverageSummary {
  const have = combinations.filter((combination) => existing.has(combination.id)).length;
  return { total: combinations.length, existing: have, missing: combinations.length - have };
}

// ---- SKU suggestions --------------------------------------------------------------------------------------------------------

/** A value as it reads in a SKU: Latin letters and digits upper-cased. A value with none (an Arabic one) is "V" and its place in the list. */
export function skuToken(value: { key: string }, position: number): string {
  const token = value.key.toUpperCase().replace(/[^A-Z0-9-]+/g, "").replace(/^-+|-+$/g, "");
  return token || `V${position + 1}`;
}

/** The default pattern: the product's slug, then every option — `TEE-{colour}-{size}`. */
export function defaultSkuPattern(slug: string, axes: readonly Pick<MatrixAxis, "key">[]): string {
  const prefix = slug.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16);
  return [prefix, ...axes.map((axis) => `{${axis.key}}`)].filter(Boolean).join("-");
}

/**
 * Fills a pattern's `{option}` tokens from a combination. A result already taken (by an existing SKU, or one suggested a
 * moment ago) gets `-2`, `-3`… — a suggestion is never a duplicate the server would then refuse.
 */
export function suggestSku(pattern: string, combination: Combination, axes: readonly MatrixAxis[], taken: ReadonlySet<string>): string {
  const filled = pattern.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const axis = axes.find((candidate) => candidate.key === key);
    const value = combination.optionValues.find((option) => option.key === key)?.value;
    if (!axis || value === undefined) return "";
    return skuToken({ key: value }, axis.values.findIndex((candidate) => candidate.key === value));
  });
  const base = filled.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "") || "SKU";
  let sku = base;
  for (let n = 2; taken.has(sku); n += 1) sku = `${base}-${n}`;
  return sku;
}

// ---- Existing variants: inline edits ----------------------------------------------------------------------------------------

export interface ExistingDraft {
  price: string;
  compareAtPrice: string;
  costPrice: string;
  active: boolean;
}

export const draftFromVariant = (variant: Pick<Variant, "price" | "compareAtPrice" | "costPrice" | "discontinued">): ExistingDraft => ({
  price: variant.price ?? "",
  compareAtPrice: variant.compareAtPrice ?? "",
  costPrice: variant.costPrice ?? "",
  active: !variant.discontinued,
});

export interface UpdateRow {
  id: string;
  price?: string;
  /** `null` clears it. */
  compareAtPrice?: string | null;
  costPrice?: string | null;
  discontinued?: boolean;
}

/** What differs between a variant and its draft, as the bulk-update row; `null` when nothing does. */
export function changesFor(variant: Pick<Variant, "_id" | "price" | "compareAtPrice" | "costPrice" | "discontinued">, draft: ExistingDraft): UpdateRow | null {
  const row: UpdateRow = { id: variant._id };
  const price = draft.price.trim();
  if (price !== (variant.price ?? "")) row.price = price;
  const compare = draft.compareAtPrice.trim();
  if (compare !== (variant.compareAtPrice ?? "")) row.compareAtPrice = compare === "" ? null : compare;
  const cost = draft.costPrice.trim();
  if (cost !== (variant.costPrice ?? "")) row.costPrice = cost === "" ? null : cost;
  if (draft.active === variant.discontinued) row.discontinued = !draft.active;
  return Object.keys(row).length > 1 ? row : null;
}

export interface FieldProblems {
  price?: string;
  compareAtPrice?: string;
  costPrice?: string;
  sku?: string;
  stock?: string;
}

const MONEY_HINT = "Use an amount like 250 or 249.99.";

function moneyProblems(draft: { price: string; compareAtPrice: string; costPrice: string }, priceRequired: boolean): FieldProblems {
  const problems: FieldProblems = {};
  if (draft.price.trim() === "") {
    if (priceRequired) problems.price = "Price is required.";
  } else if (!isMoneyInput(draft.price)) problems.price = MONEY_HINT;
  if (draft.compareAtPrice.trim() !== "" && !isMoneyInput(draft.compareAtPrice)) problems.compareAtPrice = MONEY_HINT;
  if (draft.costPrice.trim() !== "" && !isMoneyInput(draft.costPrice)) problems.costPrice = MONEY_HINT;
  return problems;
}

/** An existing variant always has a price, so a blank one is refused here rather than by the server. */
export const existingProblems = (draft: ExistingDraft): FieldProblems => moneyProblems(draft, true);

// ---- Missing combinations: bulk create ----------------------------------------------------------------------------------------

export interface CreateDraft {
  selected: boolean;
  sku: string;
  price: string;
  compareAtPrice: string;
  costPrice: string;
  /** The opening count, written as a RECEIPT by the server. */
  stock: string;
}

export const blankCreateDraft = (): CreateDraft => ({ selected: false, sku: "", price: "", compareAtPrice: "", costPrice: "", stock: "0" });

export function createProblems(draft: CreateDraft): FieldProblems {
  const problems = moneyProblems(draft, true);
  if (draft.sku.trim() === "") problems.sku = "SKU is required.";
  else if (draft.sku.trim().length > 100) problems.sku = "Keep the SKU to 100 characters.";
  if (!/^\d+$/.test(draft.stock.trim())) problems.stock = "Whole number, 0 or more.";
  return problems;
}

export interface CreateRow {
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  price: string;
  compareAtPrice?: string;
  costPrice?: string;
  stock: number;
}

export function toCreateRow(combination: Combination, draft: CreateDraft): CreateRow {
  return {
    sku: draft.sku.trim(),
    optionValues: combination.optionValues,
    price: draft.price.trim(),
    ...(draft.compareAtPrice.trim() ? { compareAtPrice: draft.compareAtPrice.trim() } : {}),
    ...(draft.costPrice.trim() ? { costPrice: draft.costPrice.trim() } : {}),
    stock: Number(draft.stock.trim()),
  };
}

/** Applies the same values to every selected missing row — the bulk "fill price for all". Blank fields are left as they are. */
export function fillSelected(drafts: Readonly<Record<string, CreateDraft>>, fill: Partial<Pick<CreateDraft, "price" | "compareAtPrice" | "costPrice" | "stock">>): Record<string, CreateDraft> {
  const next: Record<string, CreateDraft> = {};
  for (const [id, draft] of Object.entries(drafts)) {
    next[id] = draft.selected ? { ...draft, ...Object.fromEntries(Object.entries(fill).filter(([, value]) => value !== undefined && value.trim() !== "")) } : draft;
  }
  return next;
}

/** The server cap for one bulk request, mirrored so the screen can stop at it instead of being refused. */
export const MAX_BULK_ROWS = 100;

/**
 * The server answers a refused batch with `validationErrors` fielded `rows.<index>.<field>`; this maps each back to the
 * combination that row was built from, so the cell can show its own message.
 */
export function problemsByRow(validationErrors: ReadonlyArray<{ field: string; message: string }> | undefined, rowIds: readonly string[]): Map<string, Partial<Record<string, string>>> {
  const result = new Map<string, Partial<Record<string, string>>>();
  for (const error of validationErrors ?? []) {
    const match = /^rows\.(\d+)\.(.+)$/.exec(error.field);
    const id = match ? rowIds[Number(match[1])] : undefined;
    if (!match || id === undefined) continue;
    result.set(id, { ...result.get(id), [match[2]!]: error.message });
  }
  return result;
}
