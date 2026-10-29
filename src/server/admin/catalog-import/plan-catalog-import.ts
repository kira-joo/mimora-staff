import type { LocalizedLocale, LocalizedString } from "@kira-joo/toolkit-common";
import { axisKeysChanged } from "../../catalog/option-axis-keys";
import { buildVariantKey } from "../../catalog/variant-key";
import { findMissingDefaultLocalePaths } from "../../content/default-locale";
import type { ImportAttribute, ImportAxis, ImportIssue, ImportProduct, ImportProductStatus, ImportSummary, ImportVariantRow } from "./import-types";

/** What the catalog holds right now, for exactly the slugs and SKUs the file mentions. Loaded by `loadCatalogSnapshot`. */
export interface CatalogSnapshot {
  defaultLocale: LocalizedLocale;
  categories: ReadonlyMap<string, { id: string }>;
  brands: ReadonlyMap<string, { id: string }>;
  products: ReadonlyMap<string, ExistingProduct>;
  /** Every SKU of the file that exists anywhere, and whose product it belongs to. */
  skuOwners: ReadonlyMap<string, { productId: string; productSlug: string }>;
}

export interface ExistingProduct {
  id: string;
  lifecycle: ImportProductStatus;
  name: LocalizedString;
  description: LocalizedString;
  categoryId: string;
  brandId?: string;
  optionAxes: Array<{ key: string; name: LocalizedString; values?: Array<{ key: string; label: LocalizedString; swatch?: string }> }>;
  attributes: Array<{ key: string; name: LocalizedString; values: Array<{ key: string; value: LocalizedString }> }>;
  variants: ReadonlyMap<string, ExistingVariant>;
}

export interface ExistingVariant {
  id: string;
  optionValues: Array<{ key: string; value: string }>;
  stock: number;
}

export interface PlannedVariant {
  action: "create" | "update";
  row: ImportVariantRow;
  existingId?: string;
  /** Update only: target stock minus current stock, when the file asserts a count that differs. */
  stockDelta?: number;
}

export type FinalAxis = { key: string; name: LocalizedString; values: Array<{ key: string; label: LocalizedString; swatch?: string }> };
export type FinalAttribute = { key: string; name: LocalizedString; values: Array<{ key: string; value: LocalizedString }> };

export interface PlannedProduct {
  action: "create" | "update";
  row: ImportProduct;
  existing?: ExistingProduct;
  name: LocalizedString;
  description: LocalizedString;
  categoryId: string;
  brandId?: string;
  lifecycle: ImportProductStatus;
  optionAxes: FinalAxis[];
  attributes: FinalAttribute[];
  variants: PlannedVariant[];
}

export interface CatalogImportPlan {
  products: PlannedProduct[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  summary: ImportSummary;
}

const merge = (given: Partial<LocalizedString>, existing: LocalizedString | undefined, fallback: string): LocalizedString => ({
  ar: given.ar ?? existing?.ar ?? fallback,
  en: given.en ?? existing?.en ?? fallback,
});

/**
 * The axes document a product ends up with. In the file's order. A name or label the file gave wins; otherwise
 * what the product already has; otherwise the key / the value itself (in BOTH languages, so a store whose default
 * language is Arabic is never left with a label that exists only in English). Values the file does not mention
 * but the product already offers are kept — an import never shrinks an option's list.
 */
export function buildAxes(existing: ExistingProduct["optionAxes"] | undefined, imported: readonly ImportAxis[]): FinalAxis[] {
  return imported.map((axis) => {
    const current = existing?.find((candidate) => candidate.key === axis.key);
    const values: FinalAxis["values"] = (current?.values ?? []).map((value) => ({ ...value }));
    for (const given of axis.values) {
      const present = values.find((candidate) => candidate.key === given.key);
      const label = merge(given.label, present?.label, given.key);
      if (present) present.label = label;
      else values.push({ key: given.key, label });
    }
    return { key: axis.key, name: merge(axis.name, current?.name, axis.key), values };
  });
}

/** Attributes the file names replace those with the same key; attributes it does not mention are kept. */
export function buildAttributes(existing: ExistingProduct["attributes"] | undefined, imported: readonly ImportAttribute[] | undefined): FinalAttribute[] {
  const kept = (existing ?? []).map((attribute) => ({ ...attribute }));
  for (const attribute of imported ?? []) {
    const current = kept.find((candidate) => candidate.key === attribute.key);
    const built: FinalAttribute = {
      key: attribute.key,
      name: merge(attribute.name, current?.name, attribute.key),
      values: attribute.values.map((value) => ({ key: value.key, value: merge(value.value, current?.values.find((v) => v.key === value.key)?.value, value.key) })),
    };
    if (current) kept[kept.indexOf(current)] = built;
    else kept.push(built);
  }
  return kept;
}

/**
 * Staged rows come back from the database with every empty object removed (Mongoose minimises `{}` on save), so
 * "the file gave no Arabic name" arrives as a missing `name`, not `name: {}`. This puts the empty objects back, so the
 * rest of the planner reads one shape whether the rows were just parsed or were staged an hour ago.
 */
export function reviveImportProduct(product: ImportProduct): ImportProduct {
  return {
    ...product,
    name: product.name ?? {},
    description: product.description ?? {},
    variants: (product.variants ?? []).map((variant) => ({ ...variant, optionValues: variant.optionValues ?? [] })),
    ...(product.optionAxes ? { optionAxes: product.optionAxes.map((axis) => ({ ...axis, name: axis.name ?? {}, values: (axis.values ?? []).map((value) => ({ ...value, label: value.label ?? {} })) })) } : {}),
    ...(product.attributes ? { attributes: product.attributes.map((attribute) => ({ ...attribute, name: attribute.name ?? {}, values: (attribute.values ?? []).map((value) => ({ ...value, value: value.value ?? {} })) })) } : {}),
  };
}

/**
 * Turns the staged products into a plan against the catalog as it is NOW, and finds every problem that needs the
 * catalog to know: a category or brand that does not exist, a SKU another product owns, an option change on a
 * product that already has variants, a publishable product missing its default language (D-11).
 *
 * Pure — the snapshot is passed in — and run twice: when staging, to show the preview, and again inside the publish
 * transaction, because the catalog may have changed in between. A problem found at publish refuses the whole
 * batch; nothing is applied.
 *
 * Semantics worth stating once: a BLANK cell never erases existing data; a product or variant the file does not
 * mention is left alone; a stock figure is the on-hand count the file asserts — opening stock (RECEIPT) for a new
 * variant, the difference as an ADJUSTMENT for an existing one.
 */
export function planCatalogImport(staged: readonly ImportProduct[], snapshot: CatalogSnapshot): CatalogImportPlan {
  const products = staged.map(reviveImportProduct);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const planned: PlannedProduct[] = [];
  const defaultLocale = snapshot.defaultLocale;
  const otherLocale: LocalizedLocale = defaultLocale === "ar" ? "en" : "ar";
  const languageName = (locale: LocalizedLocale) => (locale === "ar" ? "Arabic" : "English");

  for (const row of products) {
    const issue = (target: ImportIssue[], line: number, message: string, extra: Partial<ImportIssue> = {}) => target.push({ row: line, slug: row.slug, message, ...extra });
    const existing = snapshot.products.get(row.slug);

    // ---- References ------------------------------------------------------------------------------------------------
    let categoryId = existing?.categoryId;
    if (row.categorySlug !== undefined) {
      const category = snapshot.categories.get(row.categorySlug);
      if (category) categoryId = category.id;
      else issue(errors, row.line, `Category "${row.categorySlug}" does not exist. Create it first, or fix the slug.`, { column: "category_slug" });
    } else if (!existing) {
      issue(errors, row.line, "category_slug is required for a new product.", { column: "category_slug" });
    }
    let brandId = existing?.brandId;
    if (row.brandSlug !== undefined) {
      const brand = snapshot.brands.get(row.brandSlug);
      if (brand) brandId = brand.id;
      else issue(errors, row.line, `Brand "${row.brandSlug}" does not exist. Create it first, or fix the slug.`, { column: "brand_slug" });
    }

    // ---- Text and D-11 ---------------------------------------------------------------------------------------------
    const name = merge(row.name, existing?.name, "");
    const description = merge(row.description, existing?.description, "");
    if (!existing && !name.ar.trim() && !name.en.trim()) issue(errors, row.line, "A new product needs a name: fill name_en or name_ar.", { column: "name_en" });

    const lifecycle: ImportProductStatus = row.status ?? existing?.lifecycle ?? "draft";
    const baseAxes = row.optionAxes ?? (existing ? undefined : []);
    if (baseAxes === undefined && row.variants.some((variant) => variant.optionValues.length > 0)) {
      // Cannot happen from the parser (it infers axes from option_values); guards a hand-built batch.
      issue(errors, row.line, "The variants carry option values but the product has no options.", { column: "option_axes" });
    }
    const optionAxes = baseAxes === undefined ? (existing?.optionAxes ?? []).map((axis) => ({ ...axis, values: axis.values ?? [] })) : buildAxes(existing?.optionAxes, baseAxes);
    const attributes = buildAttributes(existing?.attributes, row.attributes);

    if (lifecycle === "published") {
      const missing = findMissingDefaultLocalePaths({ name, description, optionAxes, attributes }, defaultLocale, (path) => path === "name");
      for (const path of missing) {
        issue(errors, row.line, `${path} has no ${languageName(defaultLocale)} text. ${languageName(defaultLocale)} is this store's default language, so a published product must carry it (D-11).`, { column: path.startsWith("name") ? `name_${defaultLocale}` : undefined });
      }
    } else if (!name[defaultLocale].trim() && name[otherLocale].trim()) {
      issue(warnings, row.line, `The name has no ${languageName(defaultLocale)} text yet. That is fine as a ${lifecycle}, but it will block publishing the product.`, { column: `name_${defaultLocale}` });
    }
    if (!existing && name[defaultLocale].trim() && !name[otherLocale].trim()) {
      issue(warnings, row.line, `The name has no ${languageName(otherLocale)} text — customers who read ${languageName(otherLocale)} will see it blank.`, { column: `name_${otherLocale}` });
    }

    // ---- Options on a product that already has variants ------------------------------------------------------------
    if (existing && existing.variants.size > 0 && baseAxes !== undefined && axisKeysChanged(existing.optionAxes, baseAxes)) {
      issue(errors, row.line, `This product already has ${existing.variants.size} variant${existing.variants.size === 1 ? "" : "s"}, so its option keys (${existing.optionAxes.map((axis) => axis.key).join(", ") || "none"}) cannot change.`, { column: "option_axes" });
    }
    const axisKeys = optionAxes.map((axis) => axis.key);

    // ---- Variants --------------------------------------------------------------------------------------------------
    const variants: PlannedVariant[] = [];
    const claimedKeys = new Map<string, number>();
    for (const variant of row.variants) {
      const vIssue = (target: ImportIssue[], message: string, column?: string) => target.push({ row: variant.line, slug: row.slug, sku: variant.sku, message, ...(column ? { column } : {}) });
      const owner = snapshot.skuOwners.get(variant.sku);
      const current = existing?.variants.get(variant.sku);

      if (owner && !current) {
        vIssue(errors, `SKU "${variant.sku}" already belongs to product "${owner.productSlug}". A SKU is unique across the store.`, "sku");
        continue;
      }

      if (current) {
        const given = variant.optionValues;
        const same = given.length === current.optionValues.length && given.every((option) => current.optionValues.some((existingOption) => existingOption.key === option.key && existingOption.value === option.value));
        if (given.length > 0 && !same) vIssue(errors, `SKU "${variant.sku}" is an existing variant with other option values (${current.optionValues.map((o) => `${o.key}=${o.value}`).join("; ") || "none"}). An import cannot change a variant's options.`, "option_values");
        const stockDelta = variant.stock !== undefined && variant.stock !== current.stock ? variant.stock - current.stock : undefined;
        variants.push({ action: "update", row: variant, existingId: current.id, ...(stockDelta !== undefined ? { stockDelta } : {}) });
      } else {
        const keys = new Set(variant.optionValues.map((option) => option.key));
        const missing = axisKeys.filter((key) => !keys.has(key));
        const extra = [...keys].filter((key) => !axisKeys.includes(key));
        if (missing.length > 0 || extra.length > 0) {
          vIssue(errors, `option_values must give exactly one value per option of this product (${axisKeys.join(", ") || "none — it has a single variant"}); ${[missing.length ? `missing ${missing.join(", ")}` : "", extra.length ? `unexpected ${extra.join(", ")}` : ""].filter(Boolean).join("; ")}.`, "option_values");
        } else {
          const key = buildVariantKey(row.slug, variant.optionValues);
          const clash = [...(existing?.variants.entries() ?? [])].find(([sku, other]) => sku !== variant.sku && buildVariantKey(row.slug, other.optionValues) === key);
          if (clash) vIssue(errors, `This option combination already exists on SKU "${clash[0]}".`, "option_values");
          const first = claimedKeys.get(key);
          if (first !== undefined) vIssue(errors, `This option combination is already on line ${first}.`, "option_values");
          else claimedKeys.set(key, variant.line);
        }
        variants.push({ action: "create", row: variant });
      }

      if (variant.compareAtPrice !== undefined && variant.price !== undefined && Number(variant.compareAtPrice) <= Number(variant.price)) {
        vIssue(warnings, `compare_at_price (${variant.compareAtPrice}) is not above price (${variant.price}), so no sale will be shown.`, "compare_at_price");
      }
    }

    if (categoryId === undefined) continue; // already an error; nothing sensible to plan
    planned.push({ action: existing ? "update" : "create", row, existing, name, description, categoryId, brandId, lifecycle, optionAxes, attributes, variants });
  }

  const sortIssues = (issues: ImportIssue[]) => issues.sort((a, b) => a.row - b.row);
  const variantsOf = planned.flatMap((product) => product.variants);
  const summary: ImportSummary = {
    lines: products.reduce((total, product) => total + product.variants.length, 0),
    products: { create: planned.filter((product) => product.action === "create").length, update: planned.filter((product) => product.action === "update").length },
    variants: { create: variantsOf.filter((variant) => variant.action === "create").length, update: variantsOf.filter((variant) => variant.action === "update").length },
    stockMovements: {
      receipts: variantsOf.filter((variant) => variant.action === "create" && (variant.row.stock ?? 0) > 0).length,
      adjustments: variantsOf.filter((variant) => variant.stockDelta !== undefined).length,
    },
    errors: errors.length,
    warnings: warnings.length,
  };
  return { products: planned, errors: sortIssues(errors), warnings: sortIssues(warnings), summary };
}
