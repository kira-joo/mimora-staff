// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CategoryModel } from "../catalog/category.schema";
import { ProductModel } from "../catalog/product.schema";
import { connectToDatabase } from "../core/db/connect";
import { getFacets } from "./get-facets";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});
afterEach(async () => {
  await Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({})]);
});
afterAll(async () => {
  await mongoose.disconnect();
});

const attribute = (key: string, name: { en: string; ar: string }, value: string, label: { en: string; ar: string }) => ({ key, name, values: [{ key: value, value: label }] });

describe("getFacets — counted keys carry the merchant's localized names", () => {
  it("attaches the axis name and each value's label, keeping the counts", async () => {
    const category = await CategoryModel.create({ slug: "c", published: true });
    const material = { en: "Material", ar: "الخامة" };
    await ProductModel.create({ slug: "a", categoryId: category._id, lifecycle: "published", name: { en: "A", ar: "أ" }, attributes: [attribute("material", material, "cotton", { en: "Cotton", ar: "قطن" })] });
    await ProductModel.create({ slug: "b", categoryId: category._id, lifecycle: "published", name: { en: "B", ar: "ب" }, attributes: [attribute("material", material, "cotton", { en: "Cotton", ar: "قطن" })] });
    await ProductModel.create({ slug: "c2", categoryId: category._id, lifecycle: "published", name: { en: "C", ar: "ج" }, attributes: [attribute("material", material, "linen", { en: "Linen", ar: "كتان" })] });

    const facets = await getFacets();
    expect(facets.attributes).toHaveLength(1);
    const [material_] = facets.attributes;
    expect(material_?.name).toEqual(material);
    expect(material_?.values.find((value) => value.key === "cotton")).toEqual({ key: "cotton", label: { en: "Cotton", ar: "قطن" }, count: 2 });
    expect(material_?.values.find((value) => value.key === "linen")).toEqual({ key: "linen", label: { en: "Linen", ar: "كتان" }, count: 1 });
    // The port's other facets pass through untouched.
    expect(Object.keys(facets).sort()).toEqual(["attributes", "brands", "categories", "inStockCount", "options", "priceRange"]);
  });

  it("falls back to the key when no readable name exists, rather than showing a blank", async () => {
    const category = await CategoryModel.create({ slug: "c", published: true });
    await ProductModel.create({ slug: "a", categoryId: category._id, lifecycle: "published", name: { en: "A", ar: "أ" }, attributes: [attribute("fit", { en: "", ar: "" }, "slim", { en: "", ar: "" })] });

    const [fit] = (await getFacets()).attributes;
    expect(fit?.name).toEqual({ ar: "fit", en: "fit" });
    expect(fit?.values[0]?.label).toEqual({ ar: "slim", en: "slim" });
  });

  it("ignores a draft product's attributes entirely", async () => {
    const category = await CategoryModel.create({ slug: "c", published: true });
    await ProductModel.create({ slug: "d", categoryId: category._id, lifecycle: "draft", name: { en: "D", ar: "د" }, attributes: [attribute("secret", { en: "Secret", ar: "سري" }, "x", { en: "X", ar: "س" })] });
    expect((await getFacets()).attributes).toEqual([]);
  });

  it("has no attributes when the catalogue has none", async () => {
    expect((await getFacets()).attributes).toEqual([]);
  });
});
