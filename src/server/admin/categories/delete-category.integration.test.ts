import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { PromotionModel } from "../../commerce/promotion.schema";
import { StorefrontContentModel } from "../../content/storefront-content.schema";
import { createCategory } from "./create-category";
import { deleteCategory } from "./delete-category";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "نص", en: "Text" };
const category = (slug: string, parentId?: string) => createCategory({ name: LOCALIZED, description: LOCALIZED, slug, parentId, seoTitle: LOCALIZED, seoDescription: LOCALIZED });
const emptyBody = { announcements: [], headerNavigation: [], footerNavigation: [], homeSections: [] };

// The guard only reads the referencing fields, so fixtures are raw inserts of exactly those — not full documents.
describe("deleteCategory", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
  beforeEach(async () => {
    await Promise.all([CategoryModel.deleteMany({}), ProductModel.collection.deleteMany({}), PromotionModel.collection.deleteMany({}), StorefrontContentModel.collection.deleteMany({})]);
  });

  it("deletes a category nothing depends on", async () => {
    const lonely = await category("lonely");
    await deleteCategory(lonely._id.toString());
    expect(await CategoryModel.countDocuments({ _id: lonely._id })).toBe(0);
  });

  it("deletes an empty sub-category and leaves its parent alone", async () => {
    const parent = await category("accessories");
    const child = await category("jewelry", parent._id.toString());
    await deleteCategory(child._id.toString());
    expect(await CategoryModel.countDocuments({ _id: child._id })).toBe(0);
    expect(await CategoryModel.countDocuments({ _id: parent._id })).toBe(1);
  });

  it("refuses while it has sub-categories, and deletes nothing", async () => {
    const parent = await category("accessories");
    await category("jewelry", parent._id.toString());
    await expect(deleteCategory(parent._id.toString())).rejects.toThrow(/1 sub-category/);
    expect(await CategoryModel.countDocuments()).toBe(2);
  });

  it("refuses while any product — archived included — is assigned, and never moves the products", async () => {
    const mugs = await category("mugs");
    await ProductModel.collection.insertMany([
      { slug: "a", categoryId: mugs._id, lifecycle: "published" },
      { slug: "b", categoryId: mugs._id, lifecycle: "archived" },
    ]);
    await expect(deleteCategory(mugs._id.toString())).rejects.toThrow(/2 products are assigned/);
    expect(await ProductModel.collection.countDocuments({ categoryId: mugs._id })).toBe(2);
    expect(await CategoryModel.countDocuments({ _id: mugs._id })).toBe(1);
  });

  it("refuses while a promotion is limited to it", async () => {
    const mugs = await category("mugs");
    await PromotionModel.collection.insertOne({ conditions: { categories: [mugs._id] } });
    await expect(deleteCategory(mugs._id.toString())).rejects.toThrow(/1 promotion is limited/);
  });

  it("refuses while the storefront content links to it — in the draft or the live version", async () => {
    const mugs = await category("mugs");
    const link = { target: { kind: "category", id: mugs._id }, label: LOCALIZED };
    await StorefrontContentModel.collection.insertOne({ draft: emptyBody, published: { ...emptyBody, headerNavigation: [link] } });
    await expect(deleteCategory(mugs._id.toString())).rejects.toThrow(/storefront content links to it/);

    await StorefrontContentModel.collection.updateOne({}, { $set: { draft: { ...emptyBody, homeSections: [{ type: "categoryTiles", categoryIds: [mugs._id] }] }, published: emptyBody } });
    await expect(deleteCategory(mugs._id.toString())).rejects.toThrow(ConflictError);
    expect(await CategoryModel.countDocuments({ _id: mugs._id })).toBe(1);
  });

  it("names every reason at once", async () => {
    const parent = await category("accessories");
    await category("jewelry", parent._id.toString());
    await ProductModel.collection.insertOne({ slug: "a", categoryId: parent._id });
    await expect(deleteCategory(parent._id.toString())).rejects.toThrow(/1 sub-category; 1 product is assigned/);
  });

  it("answers NotFound for a category that does not exist", async () => {
    await expect(deleteCategory(new mongoose.Types.ObjectId().toString())).rejects.toThrow(NotFoundError);
  });
});
