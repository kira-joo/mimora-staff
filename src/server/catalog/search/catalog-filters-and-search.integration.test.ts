// @vitest-environment node
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BrandModel } from "../brand.schema";
import { CategoryModel } from "../category.schema";
import { ProductModel } from "../product.schema";
import { VariantModel } from "../variant.schema";
import { connectToDatabase } from "../../core/db/connect";
import { maintainProductListingRollup } from "../rollups/maintain-product-listing";
import { getFacets } from "../../storefront/get-facets";
import { mongoCatalogSearchPort } from "./mongo-catalog-search-port";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

const clean = () => Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({}), VariantModel.deleteMany({}), BrandModel.deleteMany({})]);
beforeEach(clean);
afterEach(clean);
afterAll(async () => {
  await mongoose.disconnect();
});

const axes = [
  { key: "size", name: { en: "Size", ar: "المقاس" }, values: [{ key: "s", label: { en: "Small", ar: "صغير" } }, { key: "m", label: { en: "Medium", ar: "وسط" } }, { key: "l", label: { en: "Large", ar: "كبير" } }] },
  { key: "colour", name: { en: "Colour", ar: "اللون" }, values: [{ key: "red", label: { en: "Red", ar: "أحمر" } }, { key: "blue", label: { en: "Blue", ar: "أزرق" } }] },
];

interface VariantSpec {
  sku: string;
  size: string;
  colour: string;
  stock?: number;
  discontinued?: boolean;
}

/** A published product whose rollup is computed by the REAL maintainer from real variants — not hand-written listing fields. */
async function seedProduct(slug: string, name: { en: string; ar: string }, variants: VariantSpec[], extra: Record<string, unknown> = {}) {
  const category = (await CategoryModel.findOne({ slug: "cat" })) ?? (await CategoryModel.create({ slug: "cat", published: true }));
  const product = await ProductModel.create({ slug, categoryId: category._id, lifecycle: "published", name, description: { en: "", ar: "" }, optionAxes: axes, ...extra });
  for (const variant of variants) {
    await VariantModel.create({
      productId: product._id,
      sku: variant.sku,
      variantKey: `${product._id}|${variant.sku}`,
      price: toMoney("10.00"),
      stock: variant.stock ?? 5,
      discontinued: variant.discontinued ?? false,
      optionValues: [{ key: "size", value: variant.size }, { key: "colour", value: variant.colour }],
    });
  }
  await withTransaction(async (tx) => {
    await maintainProductListingRollup(product._id);
    return tx.complete(undefined);
  });
  return product;
}

const slugs = async (query: Parameters<typeof mongoCatalogSearchPort.search>[0]) => (await mongoCatalogSearchPort.search(query)).data.map((product) => product.slug).sort();

describe("in-stock filter", () => {
  it("keeps only products with a purchasable variant", async () => {
    await seedProduct("in", { en: "In", ar: "داخل" }, [{ sku: "I1", size: "s", colour: "red" }]);
    await seedProduct("out", { en: "Out", ar: "خارج" }, [{ sku: "O1", size: "s", colour: "red", stock: 0 }]);
    await seedProduct("gone", { en: "Gone", ar: "ذهب" }, [{ sku: "G1", size: "s", colour: "red", discontinued: true }]);

    expect(await slugs({})).toEqual(["gone", "in", "out"]);
    expect(await slugs({ inStock: true })).toEqual(["in"]);
    expect(await slugs({ inStock: false })).toEqual(["gone", "in", "out"]);
  });

  it("total and pagination reflect the filter, on the price-sorted path too", async () => {
    await seedProduct("a", { en: "A", ar: "ا" }, [{ sku: "A1", size: "s", colour: "red" }]);
    await seedProduct("b", { en: "B", ar: "ب" }, [{ sku: "B1", size: "s", colour: "red", stock: 0 }]);

    for (const sort of [undefined, "price_asc" as const]) {
      const result = await mongoCatalogSearchPort.search({ inStock: true, sort });
      expect({ sort, total: result.total, slugs: result.data.map((product) => product.slug) }).toEqual({ sort, total: 1, slugs: ["a"] });
    }
  });

  it("counts in-stock products in the facets", async () => {
    await seedProduct("in", { en: "In", ar: "داخل" }, [{ sku: "I1", size: "s", colour: "red" }]);
    await seedProduct("out", { en: "Out", ar: "خارج" }, [{ sku: "O1", size: "s", colour: "red", stock: 0 }]);
    expect((await mongoCatalogSearchPort.facets()).inStockCount).toBe(1);
  });
});

describe("variant option filtering — sparse matrices", () => {
  it("a value present only on a sold-out variant does not match", async () => {
    // S/red in stock; M/blue sold out. M and blue exist on no purchasable variant.
    await seedProduct("sparse", { en: "Sparse", ar: "متفرق" }, [{ sku: "SP1", size: "s", colour: "red" }, { sku: "SP2", size: "m", colour: "blue", stock: 0 }]);

    expect(await slugs({ options: [{ key: "size", value: "s" }] })).toEqual(["sparse"]);
    expect(await slugs({ options: [{ key: "size", value: "m" }] })).toEqual([]);
    expect(await slugs({ options: [{ key: "colour", value: "blue" }] })).toEqual([]);
  });

  it("a value present only on a discontinued variant does not match", async () => {
    await seedProduct("disc", { en: "Disc", ar: "قرص" }, [{ sku: "D1", size: "s", colour: "red" }, { sku: "D2", size: "l", colour: "red", discontinued: true }]);
    expect(await slugs({ options: [{ key: "size", value: "l" }] })).toEqual([]);
  });

  it("values of one axis are alternatives (OR); different axes must all match (AND)", async () => {
    await seedProduct("small-red", { en: "SR", ar: "ص" }, [{ sku: "SR", size: "s", colour: "red" }]);
    await seedProduct("large-blue", { en: "LB", ar: "ك" }, [{ sku: "LB", size: "l", colour: "blue" }]);
    await seedProduct("medium-red", { en: "MR", ar: "و" }, [{ sku: "MR", size: "m", colour: "red" }]);

    expect(await slugs({ options: [{ key: "size", value: "s" }, { key: "size", value: "l" }] })).toEqual(["large-blue", "small-red"]);
    expect(await slugs({ options: [{ key: "size", value: "s" }, { key: "size", value: "l" }, { key: "colour", value: "red" }] })).toEqual(["small-red"]);
    expect(await slugs({ options: [{ key: "size", value: "xl" }] })).toEqual([]);
  });

  it("composes with inStock, attributes and price (no clause overwrites another)", async () => {
    await seedProduct("a", { en: "A", ar: "ا" }, [{ sku: "A1", size: "s", colour: "red" }], { attributes: [{ key: "material", name: { en: "M", ar: "م" }, values: [{ key: "cotton", value: { en: "Cotton", ar: "قطن" } }] }] });
    await seedProduct("b", { en: "B", ar: "ب" }, [{ sku: "B1", size: "s", colour: "red" }], { attributes: [{ key: "material", name: { en: "M", ar: "م" }, values: [{ key: "wool", value: { en: "Wool", ar: "صوف" } }] }] });

    expect(await slugs({ inStock: true, options: [{ key: "size", value: "s" }], attributes: [{ key: "material", valueKey: "cotton" }], minPrice: "5.00", maxPrice: "20.00" })).toEqual(["a"]);
  });
});

describe("option facets", () => {
  it("counts products per option value over purchasable variants only, and omits values that are sold out everywhere", async () => {
    await seedProduct("p1", { en: "P1", ar: "١" }, [{ sku: "P1A", size: "s", colour: "red" }, { sku: "P1B", size: "m", colour: "blue", stock: 0 }]);
    await seedProduct("p2", { en: "P2", ar: "٢" }, [{ sku: "P2A", size: "s", colour: "blue" }, { sku: "P2B", size: "l", colour: "blue" }]);

    const facets = await mongoCatalogSearchPort.facets();
    const byKey = Object.fromEntries(facets.options.map((axis) => [axis.key, Object.fromEntries(axis.values.map((value) => [value.key, value.count]))]));

    expect(byKey.size).toEqual({ s: 2, l: 1 }); // m is sold out on its only variant
    expect(byKey.colour).toEqual({ red: 1, blue: 1 }); // blue counts p2 only; p1's blue variant is sold out
  });

  it("the storefront facets label axes and values in the merchant's words and order them as listed", async () => {
    await seedProduct("p1", { en: "P1", ar: "١" }, [{ sku: "P1A", size: "l", colour: "red" }, { sku: "P1B", size: "s", colour: "red" }]);

    const facets = await getFacets();
    const size = facets.options.find((axis) => axis.key === "size");
    expect(size?.name).toMatchObject({ en: "Size", ar: "المقاس" });
    expect(size?.values.map((value) => value.key)).toEqual(["s", "l"]); // listed order S, M, L — not alphabetical
    expect(size?.values[0]?.label).toMatchObject({ en: "Small", ar: "صغير" });
  });

  it("scopes counts to the search, like every other facet", async () => {
    await seedProduct("shirt", { en: "Shirt", ar: "قميص" }, [{ sku: "SH", size: "s", colour: "red" }]);
    await seedProduct("hat", { en: "Hat", ar: "قبعة" }, [{ sku: "HT", size: "l", colour: "red" }]);

    const facets = await mongoCatalogSearchPort.facets({ search: "قميص" });
    expect(facets.options.find((axis) => axis.key === "size")?.values).toEqual([{ key: "s", count: 1 }]);
  });
});

describe("search quality — Arabic normalisation, SKU and brand", () => {
  it("finds a product through alef, teh-marbuta, yeh and tashkeel spelling differences, in either direction", async () => {
    await seedProduct("dress", { en: "Dress", ar: "فُسْتَان أَنِيقَة" }, [{ sku: "DR1", size: "s", colour: "red" }]);

    expect(await slugs({ search: "فستان" })).toEqual(["dress"]); // tashkeel stripped from the stored text
    expect(await slugs({ search: "أنيقة" })).toEqual(["dress"]);
    expect(await slugs({ search: "انيقه" })).toEqual(["dress"]); // alef + teh marbuta folded in the query
    expect(await slugs({ search: "فُسْتَان" })).toEqual(["dress"]); // tashkeel in the query
  });

  it("searches the description too, and requires EVERY term", async () => {
    await seedProduct("coat", { en: "Coat", ar: "معطف" }, [{ sku: "CT1", size: "s", colour: "red" }], { description: { en: "Warm wool coat", ar: "معطف صوفي دافئ" } });

    expect(await slugs({ search: "دافئ معطف" })).toEqual(["coat"]);
    expect(await slugs({ search: "warm wool" })).toEqual(["coat"]);
    expect(await slugs({ search: "warm cotton" })).toEqual([]);
  });

  it("matches a variant SKU, case-insensitively and by fragment", async () => {
    await seedProduct("sku-prod", { en: "Plain", ar: "عادي" }, [{ sku: "ZX-9000-RED", size: "s", colour: "red" }]);
    await seedProduct("other", { en: "Other", ar: "آخر" }, [{ sku: "QQ-1", size: "s", colour: "red" }]);

    expect(await slugs({ search: "zx-9000-red" })).toEqual(["sku-prod"]);
    expect(await slugs({ search: "ZX-9000" })).toEqual(["sku-prod"]);
  });

  it("does not match the SKU of a discontinued variant", async () => {
    await seedProduct("p", { en: "Plain", ar: "عادي" }, [{ sku: "LIVE-1", size: "s", colour: "red" }, { sku: "DEAD-2", size: "l", colour: "red", discontinued: true }]);
    expect(await slugs({ search: "DEAD-2" })).toEqual([]);
  });

  it("matches the brand name in either locale, without the term appearing in the product text", async () => {
    const brand = await BrandModel.create({ slug: "nike", name: { en: "Nike", ar: "نايكي" }, published: true });
    const unpublished = await BrandModel.create({ slug: "hidden", name: { en: "Hidden", ar: "مخفي" }, published: false });
    await seedProduct("branded", { en: "Runner", ar: "عداء" }, [{ sku: "BR1", size: "s", colour: "red" }], { brandId: brand._id });
    await seedProduct("secret", { en: "Walker", ar: "ماشي" }, [{ sku: "BR2", size: "s", colour: "red" }], { brandId: unpublished._id });

    expect(await slugs({ search: "nike" })).toEqual(["branded"]);
    expect(await slugs({ search: "نايكي" })).toEqual(["branded"]);
    expect(await slugs({ search: "nike runner" })).toEqual(["branded"]); // one term in the brand, one in the name
    expect(await slugs({ search: "hidden" })).toEqual([]); // an unpublished brand is not searchable
  });

  it("treats the query as text, never as a pattern", async () => {
    await seedProduct("p", { en: "Plain", ar: "عادي" }, [{ sku: "P1", size: "s", colour: "red" }]);
    expect(await slugs({ search: ".*" })).toEqual([]);
    expect(await slugs({ search: "(" })).toEqual([]);
    expect(await slugs({ search: "[a-z]+" })).toEqual([]);
  });

  it("a blank search means no search", async () => {
    await seedProduct("p", { en: "Plain", ar: "عادي" }, [{ sku: "P1", size: "s", colour: "red" }]);
    expect(await slugs({ search: "   " })).toEqual(["p"]);
  });

  it("composes with a price sort and a filter", async () => {
    await seedProduct("p", { en: "Plain", ar: "عادي" }, [{ sku: "P1", size: "s", colour: "red" }]);
    await seedProduct("q", { en: "Plain too", ar: "عادي ايضا" }, [{ sku: "Q1", size: "l", colour: "red" }]);
    const result = await mongoCatalogSearchPort.search({ search: "plain", sort: "price_asc", options: [{ key: "size", value: "l" }] });
    expect(result.data.map((product) => product.slug)).toEqual(["q"]);
    expect(result.total).toBe(1);
  });
});
