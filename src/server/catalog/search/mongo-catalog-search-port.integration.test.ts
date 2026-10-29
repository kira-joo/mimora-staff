// @vitest-environment node
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CategoryModel } from "../category.schema";
import { ProductModel } from "../product.schema";
import { connectToDatabase } from "../../core/db/connect";
import { mongoCatalogSearchPort } from "./mongo-catalog-search-port";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

/*
 * BEFORE each test as well as after: these tests assert database-wide counts ("exactly one product
 * matches"), so they must own their starting state rather than trust every earlier test FILE to have
 * cleaned up. Measured 2026-10-21: run after a file that leaves a published product behind, the
 * first assertion saw 2 products, which read as an intermittent flake depending on file order.
 */
const clean = () => Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({})]);
beforeEach(clean);
afterEach(clean);

afterAll(async () => {
  await mongoose.disconnect();
});

async function seedProduct(overrides: { minActivePrice?: string; maxActivePrice?: string; attributes?: unknown[] } = {}) {
  const category = await CategoryModel.create({ slug: `c-${new mongoose.Types.ObjectId().toString()}` });
  return ProductModel.create({
    slug: `p-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "T", ar: "ت" },
    listing: {
      minActivePrice: overrides.minActivePrice ? toMoney(overrides.minActivePrice) : undefined,
      maxActivePrice: overrides.maxActivePrice ? toMoney(overrides.maxActivePrice) : undefined,
      purchasableVariantCount: 1,
    },
    attributes: (overrides.attributes as never[] | undefined) ?? [],
  });
}

describe("mongoCatalogSearchPort — price-range filtering", () => {
  it("returns a product whose active price range overlaps the query range", async () => {
    await seedProduct({ minActivePrice: "10.00", maxActivePrice: "20.00" });

    const result = await mongoCatalogSearchPort.search({ minPrice: "15.00", maxPrice: "25.00" });
    expect(result.data).toHaveLength(1);
  });

  it("excludes a product entirely below the query's minimum", async () => {
    await seedProduct({ minActivePrice: "5.00", maxActivePrice: "9.00" });

    const result = await mongoCatalogSearchPort.search({ minPrice: "10.00" });
    expect(result.data).toHaveLength(0);
  });

  it("excludes a product entirely above the query's maximum", async () => {
    await seedProduct({ minActivePrice: "100.00", maxActivePrice: "200.00" });

    const result = await mongoCatalogSearchPort.search({ maxPrice: "50.00" });
    expect(result.data).toHaveLength(0);
  });

  it("a wide product range (e.g. $10-$50) still matches a narrower contained query range ($20-$30) — overlap, not containment of a single bound", async () => {
    await seedProduct({ minActivePrice: "10.00", maxActivePrice: "50.00" });

    const result = await mongoCatalogSearchPort.search({ minPrice: "20.00", maxPrice: "30.00" });
    expect(result.data).toHaveLength(1);
  });
});

describe("mongoCatalogSearchPort — attribute filtering", () => {
  it("matches a product carrying the requested attribute value", async () => {
    await seedProduct({ attributes: [{ key: "material", name: { en: "Material", ar: "خامة" }, values: [{ key: "cotton", value: { en: "Cotton", ar: "قطن" } }] }] });

    const result = await mongoCatalogSearchPort.search({ attributes: [{ key: "material", valueKey: "cotton" }] });
    expect(result.data).toHaveLength(1);
  });

  it("excludes a product with a different value for the same attribute", async () => {
    await seedProduct({ attributes: [{ key: "material", name: { en: "x", ar: "x" }, values: [{ key: "wool", value: { en: "x", ar: "x" } }] }] });

    const result = await mongoCatalogSearchPort.search({ attributes: [{ key: "material", valueKey: "cotton" }] });
    expect(result.data).toHaveLength(0);
  });

  it("requires ALL requested attribute filters to match — a product missing one of two is excluded", async () => {
    await seedProduct({
      attributes: [{ key: "material", name: { en: "x", ar: "x" }, values: [{ key: "cotton", value: { en: "x", ar: "x" } }] }],
    });

    const result = await mongoCatalogSearchPort.search({
      attributes: [
        { key: "material", valueKey: "cotton" },
        { key: "fit", valueKey: "slim" }, // this product has no "fit" attribute at all
      ],
    });
    expect(result.data).toHaveLength(0);
  });

  it("does not cross-match values from different attribute entries", async () => {
    // A product with material=cotton AND fit=slim must not match a filter for material=slim (a value that only exists under "fit").
    await seedProduct({
      attributes: [
        { key: "material", name: { en: "x", ar: "x" }, values: [{ key: "cotton", value: { en: "x", ar: "x" } }] },
        { key: "fit", name: { en: "x", ar: "x" }, values: [{ key: "slim", value: { en: "x", ar: "x" } }] },
      ],
    });

    const result = await mongoCatalogSearchPort.search({ attributes: [{ key: "material", valueKey: "slim" }] });
    expect(result.data).toHaveLength(0);
  });
});

describe("mongoCatalogSearchPort.facets — price range and attributes", () => {
  it("reports the overall min/max active price across published products", async () => {
    await seedProduct({ minActivePrice: "10.00", maxActivePrice: "10.00" });
    await seedProduct({ minActivePrice: "90.00", maxActivePrice: "90.00" });

    const facets = await mongoCatalogSearchPort.facets();
    expect(facets.priceRange.min).toBe("10.00");
    expect(facets.priceRange.max).toBe("90.00");
  });

  it("counts products per attribute value, grouped under their own attribute key", async () => {
    await seedProduct({ attributes: [{ key: "material", name: { en: "x", ar: "x" }, values: [{ key: "cotton", value: { en: "x", ar: "x" } }] }] });
    await seedProduct({ attributes: [{ key: "material", name: { en: "x", ar: "x" }, values: [{ key: "cotton", value: { en: "x", ar: "x" } }] }] });
    await seedProduct({ attributes: [{ key: "material", name: { en: "x", ar: "x" }, values: [{ key: "wool", value: { en: "x", ar: "x" } }] }] });

    const facets = await mongoCatalogSearchPort.facets();
    const material = facets.attributes.find((a) => a.key === "material");
    expect(material?.values.sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: "cotton", count: 2 },
      { key: "wool", count: 1 },
    ]);
  });

  it("returns an empty attributes facet list when no product carries any attribute data", async () => {
    await seedProduct({});

    const facets = await mongoCatalogSearchPort.facets();
    expect(facets.attributes).toEqual([]);
  });
});

describe("mongoCatalogSearchPort — category tree, collection, sort, attribute OR/AND", () => {
  async function product(slug: string, categoryId: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) {
    return ProductModel.create({ slug, categoryId, lifecycle: "published", name: { en: slug, ar: slug }, ...extra });
  }
  const priced = (min?: string) => ({ listing: { minActivePrice: min ? toMoney(min) : undefined, maxActivePrice: min ? toMoney(min) : undefined, purchasableVariantCount: min ? 1 : 0 } });
  const attr = (key: string, valueKey: string) => ({ key, name: { en: key, ar: key }, values: [{ key: valueKey, value: { en: valueKey, ar: valueKey } }] });

  it("categoryId lists the published descendants' products, not an unpublished branch", async () => {
    const parent = await CategoryModel.create({ slug: "parent", published: true });
    const child = await CategoryModel.create({ slug: "child", parentId: parent._id, published: true });
    const hidden = await CategoryModel.create({ slug: "hidden", parentId: parent._id, published: false });
    const hiddenChild = await CategoryModel.create({ slug: "hidden-child", parentId: hidden._id, published: true });
    const other = await CategoryModel.create({ slug: "other", published: true });
    await product("in-parent", parent._id);
    await product("in-child", child._id);
    await product("in-hidden", hidden._id);
    await product("in-hidden-child", hiddenChild._id);
    await product("elsewhere", other._id);

    const result = await mongoCatalogSearchPort.search({ categoryId: parent._id.toString() });
    expect(result.data.map((p) => p.slug).sort()).toEqual(["in-child", "in-parent"]);
  });

  it("collectionId filters to products in that collection", async () => {
    const category = await CategoryModel.create({ slug: "c" });
    const collectionId = new mongoose.Types.ObjectId();
    await product("in", category._id, { collectionIds: [collectionId] });
    await product("out", category._id, { collectionIds: [new mongoose.Types.ObjectId()] });

    const result = await mongoCatalogSearchPort.search({ collectionId: collectionId.toString() });
    expect(result.data.map((p) => p.slug)).toEqual(["in"]);
  });

  it("sorts price_asc / price_desc by minActivePrice with unpriced products last in both, and paginates that order", async () => {
    const category = await CategoryModel.create({ slug: "c" });
    await product("mid", category._id, priced("20.00"));
    await product("none", category._id, priced());
    await product("cheap", category._id, priced("5.00"));
    await product("dear", category._id, priced("90.00"));

    const asc = await mongoCatalogSearchPort.search({ sort: "price_asc" });
    expect(asc.data.map((p) => p.slug)).toEqual(["cheap", "mid", "dear", "none"]);
    expect(asc.total).toBe(4);

    const desc = await mongoCatalogSearchPort.search({ sort: "price_desc" });
    expect(desc.data.map((p) => p.slug)).toEqual(["dear", "mid", "cheap", "none"]);

    const page2 = await mongoCatalogSearchPort.search({ sort: "price_asc", page: 2, limit: 2 });
    expect(page2.data.map((p) => p.slug)).toEqual(["dear", "none"]);
    expect(page2).toMatchObject({ page: 2, limit: 2, totalPages: 2 });
  });

  it("price sort still honours the other filters and search", async () => {
    const category = await CategoryModel.create({ slug: "c" });
    await product("olive-tee", category._id, priced("30.00"));
    await product("olive-cap", category._id, priced("10.00"));
    await product("blue-tee", category._id, priced("5.00"));

    const result = await mongoCatalogSearchPort.search({ sort: "price_asc", search: "olive" });
    expect(result.data.map((p) => p.slug)).toEqual(["olive-cap", "olive-tee"]);
  });

  it("sort=newest orders by createdAt descending", async () => {
    const category = await CategoryModel.create({ slug: "c" });
    await product("first", category._id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await product("second", category._id);

    expect((await mongoCatalogSearchPort.search({ sort: "newest" })).data.map((p) => p.slug)).toEqual(["second", "first"]);
  });

  it("attribute values of one key are alternatives (OR); different keys must all match (AND)", async () => {
    const category = await CategoryModel.create({ slug: "c" });
    await product("cotton-slim", category._id, { attributes: [attr("material", "cotton"), attr("fit", "slim")] });
    await product("linen-slim", category._id, { attributes: [attr("material", "linen"), attr("fit", "slim")] });
    await product("wool-loose", category._id, { attributes: [attr("material", "wool"), attr("fit", "loose")] });

    const or = await mongoCatalogSearchPort.search({ attributes: [{ key: "material", valueKey: "cotton" }, { key: "material", valueKey: "linen" }] });
    expect(or.data.map((p) => p.slug).sort()).toEqual(["cotton-slim", "linen-slim"]);

    const and = await mongoCatalogSearchPort.search({
      attributes: [{ key: "material", valueKey: "cotton" }, { key: "material", valueKey: "wool" }, { key: "fit", valueKey: "slim" }],
    });
    expect(and.data.map((p) => p.slug)).toEqual(["cotton-slim"]);
  });

  it("facets reflect the same scope: category tree, collection and search", async () => {
    const parent = await CategoryModel.create({ slug: "parent", published: true });
    const child = await CategoryModel.create({ slug: "child", parentId: parent._id, published: true });
    const other = await CategoryModel.create({ slug: "other", published: true });
    const collectionId = new mongoose.Types.ObjectId();
    await product("a", child._id, { attributes: [attr("material", "cotton")], collectionIds: [collectionId], ...priced("10.00") });
    await product("b", other._id, { attributes: [attr("material", "wool")], ...priced("99.00") });

    const whole = await mongoCatalogSearchPort.facets();
    expect(whole.categories).toHaveLength(2);

    const scoped = await mongoCatalogSearchPort.facets({ categoryId: parent._id.toString() });
    expect(scoped.categories).toEqual([{ key: child._id.toString(), count: 1 }]);
    expect(scoped.attributes).toEqual([{ key: "material", values: [{ key: "cotton", count: 1 }] }]);
    expect(scoped.priceRange).toEqual({ min: "10.00", max: "10.00" });

    expect((await mongoCatalogSearchPort.facets({ collectionId: collectionId.toString() })).categories).toHaveLength(1);
    expect((await mongoCatalogSearchPort.facets({ search: "b" })).attributes[0]?.values[0]?.key).toBe("wool");
  });
});
