// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BrandModel } from "../catalog/brand.schema";
import { CategoryModel } from "../catalog/category.schema";
import { CollectionModel } from "../catalog/collection.schema";
import { connectToDatabase } from "../core/db/connect";
import { getBrands } from "./get-brands";
import { getCategories } from "./get-categories";
import { getCollections } from "./get-collections";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([CategoryModel.deleteMany({}), CollectionModel.deleteMany({}), BrandModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("getCategories", () => {
  it("returns only published categories, sorted by sortOrder, with localized content intact", async () => {
    await CategoryModel.create([
      { name: { en: "Shirts", ar: "قمصان" }, slug: "shirts", published: true, sortOrder: 1 },
      { name: { en: "Pants", ar: "بناطيل" }, slug: "pants", published: true, sortOrder: 0 },
      { name: { en: "Draft", ar: "مسودة" }, slug: "draft", published: false, sortOrder: -1 },
    ]);

    const categories = await getCategories();
    expect(categories.map((c) => c.slug)).toEqual(["pants", "shirts"]);
    expect(categories[0]?.name.ar).toBe("بناطيل"); // Arabic content survives the round trip untouched
  });

  it("returns an empty array, not an error, when nothing is published", async () => {
    expect(await getCategories()).toEqual([]);
  });
});

describe("getCollections", () => {
  it("returns only published collections, sorted by sortOrder", async () => {
    await CollectionModel.create([
      { name: { en: "Sale", ar: "تخفيضات" }, slug: "sale", published: true, sortOrder: 0 },
      { name: { en: "Draft", ar: "مسودة" }, slug: "draft", published: false, sortOrder: 1 },
    ]);

    const collections = await getCollections();
    expect(collections.map((c) => c.slug)).toEqual(["sale"]);
  });
});

describe("getBrands", () => {
  it("returns only published brands", async () => {
    await BrandModel.create([
      { name: { en: "Acme", ar: "أكمي" }, slug: "acme", description: { en: "x", ar: "x" }, published: true },
      { name: { en: "Draft", ar: "مسودة" }, slug: "draft", description: { en: "x", ar: "x" }, published: false },
    ]);

    const brands = await getBrands();
    expect(brands.map((b) => b.slug)).toEqual(["acme"]);
  });
});
