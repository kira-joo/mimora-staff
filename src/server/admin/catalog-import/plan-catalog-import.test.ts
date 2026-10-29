import { describe, expect, it } from "vitest";
import type { LocalizedLocale } from "@kira-joo/toolkit-common";
import { buildAttributes, buildAxes, planCatalogImport, type CatalogSnapshot, type ExistingProduct } from "./plan-catalog-import";
import type { ImportProduct, ImportVariantRow } from "./import-types";

const variant = (sku: string, extra: Partial<ImportVariantRow> = {}, line = 2): ImportVariantRow => ({ line, sku, optionValues: [], price: "10", ...extra });
const product = (extra: Partial<ImportProduct> = {}): ImportProduct => ({ line: 2, slug: "tee", name: { en: "Tee", ar: "تي شيرت" }, description: {}, categorySlug: "tops", variants: [variant("TEE-1")], ...extra });

const existingProduct = (extra: Partial<ExistingProduct> = {}): ExistingProduct => ({
  id: "p1",
  lifecycle: "draft",
  name: { en: "Old tee", ar: "قديم" },
  description: { en: "Old text", ar: "نص قديم" },
  categoryId: "c-old",
  optionAxes: [],
  attributes: [],
  variants: new Map(),
  ...extra,
});

function snapshot(extra: Partial<CatalogSnapshot & { productList: ExistingProduct[] }> = {}, defaultLocale: LocalizedLocale = "ar"): CatalogSnapshot {
  return {
    defaultLocale,
    categories: new Map([["tops", { id: "c-tops" }]]),
    brands: new Map([["acme", { id: "b-acme" }]]),
    products: new Map(),
    skuOwners: new Map(),
    ...extra,
  };
}

const messages = (plan: ReturnType<typeof planCatalogImport>) => plan.errors.map((e) => `${e.row}:${e.column ?? "-"}:${e.message}`);

describe("planCatalogImport — references", () => {
  it("plans a new product and resolves its category and brand", () => {
    const plan = planCatalogImport([product({ brandSlug: "acme" })], snapshot());
    expect(plan.errors).toEqual([]);
    expect(plan.products[0]).toMatchObject({ action: "create", categoryId: "c-tops", brandId: "b-acme", lifecycle: "draft" });
    expect(plan.summary).toMatchObject({ products: { create: 1, update: 0 }, variants: { create: 1, update: 0 } });
  });

  it("refuses a category or brand that does not exist, and a new product with no category", () => {
    const plan = planCatalogImport([product({ categorySlug: "nope", brandSlug: "ghost" }), product({ slug: "mug", categorySlug: undefined })], snapshot());
    expect(messages(plan)).toEqual([
      expect.stringContaining('2:category_slug:Category "nope" does not exist'),
      expect.stringContaining('2:brand_slug:Brand "ghost" does not exist'),
      expect.stringContaining("2:category_slug:category_slug is required for a new product"),
    ]);
  });

  it("refuses a SKU that belongs to another product", () => {
    const plan = planCatalogImport([product()], snapshot({ skuOwners: new Map([["TEE-1", { productId: "other", productSlug: "mug" }]]) }));
    expect(messages(plan)).toEqual([expect.stringContaining('SKU "TEE-1" already belongs to product "mug"')]);
  });
});

describe("planCatalogImport — updates keep what the file does not say", () => {
  it("a blank cell never erases: only the locale given changes, the rest is the existing value", () => {
    const plan = planCatalogImport([product({ name: { en: "New tee" }, description: {}, categorySlug: undefined })], snapshot({ products: new Map([["tee", existingProduct()]]) }));
    expect(plan.errors).toEqual([]);
    expect(plan.products[0]).toMatchObject({ action: "update", name: { en: "New tee", ar: "قديم" }, description: { en: "Old text", ar: "نص قديم" }, categoryId: "c-old", lifecycle: "draft" });
  });

  it("matches variants by SKU: an existing one updates, an unknown one is created, and a SKU the file omits is not touched", () => {
    const existing = existingProduct({ variants: new Map([["TEE-1", { id: "v1", optionValues: [], stock: 4 }], ["TEE-OLD", { id: "v2", optionValues: [], stock: 1 }]]) });
    const plan = planCatalogImport([product({ variants: [variant("TEE-1", { stock: 4 }), variant("TEE-2")] })], snapshot({ products: new Map([["tee", existing]]) }));
    const [first, second] = plan.products[0]!.variants;
    expect(first).toMatchObject({ action: "update", existingId: "v1" });
    expect(first?.stockDelta).toBeUndefined();
    expect(second?.action).toBe("create");
    // The existing single-variant product has no options, so TEE-2 would be a second variant on the same (empty) combination.
    expect(messages(plan)).toEqual([expect.stringContaining('This option combination already exists on SKU "TEE-1"')]);
  });

  it("stock: a new variant is an opening-stock receipt; an existing one's difference is an adjustment, in either direction", () => {
    const axes = { optionAxes: [{ key: "size", name: { en: "Size", ar: "المقاس" } }] };
    const existing = existingProduct({ ...axes, variants: new Map([["S", { id: "v1", optionValues: [{ key: "size", value: "s" }], stock: 10 }], ["M", { id: "v2", optionValues: [{ key: "size", value: "m" }], stock: 3 }]]) });
    const row = product({
      optionAxes: [{ key: "size", name: {}, values: [] }],
      variants: [variant("S", { optionValues: [{ key: "size", value: "s" }], stock: 7 }), variant("M", { optionValues: [{ key: "size", value: "m" }], stock: 9 }), variant("L", { optionValues: [{ key: "size", value: "l" }], stock: 5 }), variant("XL", { optionValues: [{ key: "size", value: "xl" }] })],
    });
    const plan = planCatalogImport([row], snapshot({ products: new Map([["tee", existing]]) }));
    expect(plan.errors).toEqual([]);
    expect(plan.products[0]!.variants.map((v) => [v.row.sku, v.action, v.stockDelta])).toEqual([["S", "update", -3], ["M", "update", 6], ["L", "create", undefined], ["XL", "create", undefined]]);
    expect(plan.summary.stockMovements).toEqual({ receipts: 1, adjustments: 2 });
  });

  it("will not change an existing variant's options, nor a product's option keys once it has variants", () => {
    const existing = existingProduct({ optionAxes: [{ key: "size", name: { en: "Size", ar: "" } }], variants: new Map([["S", { id: "v1", optionValues: [{ key: "size", value: "s" }], stock: 1 }]]) });
    const row = product({ optionAxes: [{ key: "colour", name: {}, values: [{ key: "red", label: {} }] }], variants: [variant("S", { optionValues: [{ key: "colour", value: "red" }] })] });
    const text = messages(planCatalogImport([row], snapshot({ products: new Map([["tee", existing]]) })));
    expect(text.some((line) => /option keys \(size\) cannot change/.test(line))).toBe(true);
    expect(text.some((line) => /cannot change a variant's options/.test(line))).toBe(true);
  });

  it("refuses a new variant whose options do not match the product's", () => {
    const row = product({ optionAxes: [{ key: "size", name: {}, values: [] }], variants: [variant("S", { optionValues: [] })] });
    expect(messages(planCatalogImport([row], snapshot()))).toEqual([expect.stringContaining("option_values must give exactly one value per option of this product (size)")]);
  });
});

describe("planCatalogImport — D-11, the default language", () => {
  const names = { ar: { en: "Only English" }, en: { ar: "بالعربية فقط" } };

  it("blocks a PUBLISHED product with no default-language name, naming the language", () => {
    const plan = planCatalogImport([product({ status: "published", name: names.ar })], snapshot({}, "ar"));
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatchObject({ column: "name_ar" });
    expect(plan.errors[0]?.message).toMatch(/Arabic is this store's default language.*D-11/);
  });

  it("the language that is required follows the store's default language", () => {
    expect(planCatalogImport([product({ status: "published", name: names.en })], snapshot({}, "ar")).errors).toEqual([]);
    expect(planCatalogImport([product({ status: "published", name: names.en })], snapshot({}, "en")).errors).toHaveLength(1);
  });

  it("blocks a published product whose DESCRIPTION exists only in the secondary language, but not one with none at all", () => {
    expect(planCatalogImport([product({ status: "published", description: { en: "English only" } })], snapshot({}, "ar")).errors).toHaveLength(1);
    expect(planCatalogImport([product({ status: "published", description: {} })], snapshot({}, "ar")).errors).toEqual([]);
  });

  it("only warns for a draft — it will block publishing later — and warns when the secondary language is missing", () => {
    const draft = planCatalogImport([product({ name: names.ar })], snapshot({}, "ar"));
    expect(draft.errors).toEqual([]);
    expect(draft.warnings.map((w) => w.message).join(" ")).toMatch(/will block publishing/);
    const missingSecondary = planCatalogImport([product({ name: names.en })], snapshot({}, "ar"));
    expect(missingSecondary.warnings.map((w) => w.message).join(" ")).toMatch(/English text/);
  });

  it("a new product with no name in either language is an error", () => {
    expect(planCatalogImport([product({ name: {} })], snapshot()).errors.map((e) => e.column)).toEqual(["name_en"]);
  });
});

describe("planCatalogImport — warnings and summary", () => {
  it("warns when compare-at is not above the price", () => {
    const plan = planCatalogImport([product({ variants: [variant("A", { price: "10", compareAtPrice: "10" }), variant("B", { price: "10", compareAtPrice: "12.50" })].map((v, i) => ({ ...v, optionValues: [], line: 2 + i })) })], snapshot({}));
    expect(plan.warnings.filter((w) => w.column === "compare_at_price")).toHaveLength(1);
  });

  it("counts what publishing would do", () => {
    const row = product({ optionAxes: [{ key: "size", name: {}, values: [] }], variants: [variant("S", { optionValues: [{ key: "size", value: "s" }], stock: 5 }), variant("M", { optionValues: [{ key: "size", value: "m" }] })] });
    expect(planCatalogImport([row], snapshot()).summary).toEqual({ lines: 2, products: { create: 1, update: 0 }, variants: { create: 2, update: 0 }, stockMovements: { receipts: 1, adjustments: 0 }, errors: 0, warnings: 0 });
  });
});

describe("buildAxes and buildAttributes", () => {
  it("defaults a label to the value itself in BOTH languages, and never shrinks an existing option's values", () => {
    const existing = [{ key: "colour", name: { en: "Colour", ar: "اللون" }, values: [{ key: "red", label: { en: "Red", ar: "أحمر" }, swatch: "#ff0000" }] }];
    const built = buildAxes(existing, [{ key: "colour", name: {}, values: [{ key: "blue", label: {} }, { key: "red", label: { en: "Crimson" } }] }]);
    expect(built[0]?.name).toEqual({ en: "Colour", ar: "اللون" });
    expect(built[0]?.values).toEqual([
      { key: "red", label: { en: "Crimson", ar: "أحمر" }, swatch: "#ff0000" },
      { key: "blue", label: { en: "blue", ar: "blue" } },
    ]);
  });

  it("replaces attributes with the same key and keeps the others", () => {
    const existing = [
      { key: "material", name: { en: "Material", ar: "الخامة" }, values: [{ key: "wool", value: { en: "Wool", ar: "صوف" } }] },
      { key: "care", name: { en: "Care", ar: "العناية" }, values: [{ key: "cold", value: { en: "Cold wash", ar: "غسيل بارد" } }] },
    ];
    const built = buildAttributes(existing, [{ key: "material", name: {}, values: [{ key: "cotton", value: { en: "Cotton" } }] }]);
    expect(built.map((a) => a.key)).toEqual(["material", "care"]);
    expect(built[0]).toEqual({ key: "material", name: { en: "Material", ar: "الخامة" }, values: [{ key: "cotton", value: { en: "Cotton", ar: "cotton" } }] });
  });
});
