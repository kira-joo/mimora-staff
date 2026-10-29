import mongoose from "mongoose";
import { ValidationFailedError } from "@kira-joo/backend-toolkit-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { CategoryModel } from "./category.schema";
import { ProductModel } from "./product.schema";
import { PageModel } from "../content/page.schema";
import { PageRevisionModel } from "../content/page-revision.schema";
import { StoreProfileModel } from "../content/store-profile.schema";
import { createProduct } from "../admin/products/create-product";
import { updateProduct } from "../admin/products/update-product";
import { setProductLifecycle } from "../admin/products/set-product-lifecycle";
import { createPage } from "../admin/pages/create-page";
import { updatePage } from "../admin/pages/update-page";

/**
 * D-11 — "block publish unless the default locale is complete; warn but
 * allow for the secondary" — at every point a product or page becomes, or
 * stays, visible to customers.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const L = (ar: string, en: string) => ({ ar, en });
let categoryId: string;
let sequence = 0;

const product = (name = L("قميص", "Shirt"), extra: Record<string, unknown> = {}) =>
  createProduct({ name, description: L("", ""), slug: `p-${++sequence}-${Date.now()}`, categoryId, ...extra });

async function fieldsOf(promise: Promise<unknown>): Promise<string[]> {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ValidationFailedError);
  return (error as ValidationFailedError).validationErrors.map((e) => e.field);
}

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await Promise.all([ProductModel.deleteMany({}), CategoryModel.deleteMany({}), PageModel.deleteMany({}), PageRevisionModel.deleteMany({}), StoreProfileModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([ProductModel.deleteMany({}), CategoryModel.deleteMany({}), PageModel.deleteMany({}), PageRevisionModel.deleteMany({}), StoreProfileModel.deleteMany({})]);
  categoryId = (await CategoryModel.create({ name: L("قمصان", "Shirts"), slug: `c-${Date.now()}`, published: true, sortOrder: 0 }))._id.toString();
});

describe("products", () => {
  it("publishes an Arabic-only product — the secondary locale is not required", async () => {
    const draft = await product(L("قميص", ""));
    expect((await setProductLifecycle(draft._id.toString(), "published")).lifecycle).toBe("published");
  });

  it("refuses to publish without the Arabic name, naming the field, and leaves the product a draft", async () => {
    const draft = await product(L("", "Shirt"));
    expect(await fieldsOf(setProductLifecycle(draft._id.toString(), "published"))).toEqual(["name"]);
    expect((await ProductModel.findById(draft._id).lean())?.lifecycle).toBe("draft");
  });

  it("refuses to publish English-only content anywhere the product shows it", async () => {
    const draft = await product(L("قميص", "Shirt"), { description: L("", "Washed linen"), optionAxes: [{ key: "size", name: L("", "Size") }] });
    expect(await fieldsOf(setProductLifecycle(draft._id.toString(), "published"))).toEqual(["description", "optionAxes.0.name"]);
  });

  it("still allows saving an incomplete draft — the rule is at publication, not at every save", async () => {
    const draft = await product(L("", "Shirt"));
    await expect(updateProduct(draft._id.toString(), { description: L("", "Linen") })).resolves.toBeDefined();
  });

  it("refuses to create a product directly as published without its Arabic name", async () => {
    expect(await fieldsOf(product(L("", "Shirt"), { lifecycle: "published" }))).toEqual(["name"]);
    expect(await ProductModel.countDocuments({})).toBe(0);
  });

  it("refuses an edit that would leave a live product without its Arabic name", async () => {
    const live = await product(L("قميص", "Shirt"), { lifecycle: "published" });
    expect(await fieldsOf(updateProduct(live._id.toString(), { name: L("", "Shirt") }))).toEqual(["name"]);
    expect((await ProductModel.findById(live._id).lean())?.name.ar).toBe("قميص");
  });

  it("unpublishing never needs the check", async () => {
    const draft = await product(L("", "Shirt"));
    await expect(setProductLifecycle(draft._id.toString(), "archived")).resolves.toBeDefined();
  });

  it("follows the store's default locale — an English-default store needs English", async () => {
    await StoreProfileModel.collection.insertOne({ defaultLocale: "en" });
    const draft = await product(L("قميص", ""));
    expect(await fieldsOf(setProductLifecycle(draft._id.toString(), "published"))).toEqual(["name"]);
  });
});

describe("pages", () => {
  it("refuses to publish a page without its Arabic title and content", async () => {
    expect(await fieldsOf(createPage({ slug: "terms", title: L("", "Terms"), content: L("", "Text"), published: true }))).toEqual(["title", "content"]);
    expect(await PageModel.countDocuments({})).toBe(0);
  });

  it("refuses to publish a draft page that is still English-only", async () => {
    const page = await createPage({ slug: "terms", title: L("", "Terms"), content: L("", "Text") });
    expect(await fieldsOf(updatePage(page._id.toString(), { published: true }))).toEqual(["title", "content"]);
    expect((await PageModel.findById(page._id).lean())?.published).toBe(false);
  });

  it("refuses an edit that would leave a published page without Arabic content", async () => {
    const page = await createPage({ slug: "terms", title: L("الشروط", "Terms"), content: L("نص", "Text"), published: true });
    expect(await fieldsOf(updatePage(page._id.toString(), { content: L("", "New text") }))).toEqual(["content"]);
    expect((await PageModel.findById(page._id).lean())?.version).toBe(1);
  });

  it("publishes an Arabic-only page", async () => {
    await expect(createPage({ slug: "terms", title: L("الشروط", ""), content: L("نص", ""), published: true })).resolves.toBeDefined();
  });
});
