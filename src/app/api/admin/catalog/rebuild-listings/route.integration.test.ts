import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { rebuildAllProductListings } from "src/server/catalog/rollups/rebuild-product-listings";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../../test-support/admin-route-harness";

/**
 * `POST /api/admin/catalog/rebuild-listings`: the backfill for products written before a listing rollup field existed.
 * It must fill the missing fields, be safe to run twice, be refused to anyone without `Catalog.publish` (changing
 * nothing and invalidating nothing), and declare the PRODUCTS tag only when it succeeded.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const post = (await import("./route")).POST as RouteHandler;
const PATH = "/api/admin/catalog/rebuild-listings";

let owner: AdminCaller;
const revalidations: Array<{ tags: string[] }> = [];
const realFetch = globalThis.fetch;

const clean = () => Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);

async function seedLegacyProduct(label: string) {
  const category = await CategoryModel.findOne({}) ?? (await CategoryModel.create({ slug: "tops", name: { ar: "ملابس", en: "Tops" }, published: true }));
  const product = await ProductModel.create({ slug: `p-${label}`, categoryId: category._id, lifecycle: "published", name: { en: label, ar: label } });
  await VariantModel.create([
    { productId: product._id, sku: `${label}-S`, variantKey: `${label}-s`, price: toMoney("10.00"), stock: 2, optionValues: [{ key: "size", value: "s" }] },
    { productId: product._id, sku: `${label}-M`, variantKey: `${label}-m`, price: toMoney("12.00"), stock: 0, optionValues: [{ key: "size", value: "m" }] },
  ]);
  return product;
}
const listingOf = async (id: unknown) => (await ProductModel.findById(id).lean())?.listing;

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([removeHarnessStaff(), clean()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await clean();
  revalidations.length = 0;
  process.env.STOREFRONT_REVALIDATE_URL = "http://storefront.test/api/revalidate";
  process.env.REVALIDATE_SECRET = "test-revalidate-secret";
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("http://storefront.test/")) {
      revalidations.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    }
    return realFetch(url, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/admin/catalog/rebuild-listings", () => {
  it("gives a product written before the rollup fields existed its availableOptions and low-stock facts, and revalidates PRODUCTS", async () => {
    const product = await seedLegacyProduct("legacy");
    const before = await listingOf(product._id);
    expect(before?.availableOptions).toBeUndefined();

    const response = await owner.call(post, PATH, { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1, batches: 1 });
    const after = await listingOf(product._id);
    expect(after?.availableOptions).toEqual(["size:s"]);
    expect(after?.purchasableVariantCount).toBe(1);
    expect(after?.minTrackedStock).toBe(2);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
    expect(revalidations[0]?.tags).toEqual(["PRODUCTS"]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const product = await seedLegacyProduct("twice");
    await owner.call(post, PATH, { method: "POST" });
    const first = JSON.stringify(await listingOf(product._id));

    const second = await owner.call(post, PATH, { method: "POST" });

    expect(second.status).toBe(200);
    expect(JSON.stringify(await listingOf(product._id))).toBe(first);
  });

  it("an empty catalog is a clean no-op", async () => {
    const response = await owner.call(post, PATH, { method: "POST" });
    expect(await response.json()).toEqual({ processed: 0, batches: 0 });
  });

  it("NEGATIVE: staff without Catalog.publish get 403, nothing is rebuilt and nothing is revalidated", async () => {
    const product = await seedLegacyProduct("denied");
    const editor = await signInWithPermissions([AppPermission.PRODUCT.UPDATE, AppPermission.PRODUCT.READ]);

    const response = await editor.call(post, PATH, { method: "POST" });

    expect(response.status).toBe(403);
    expect((await listingOf(product._id))?.availableOptions).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(revalidations).toEqual([]);
  });

  it("a staff member holding exactly Catalog.publish may run it", async () => {
    await seedLegacyProduct("allowed");
    const publisher = await signInWithPermissions([CustomPermission.CATALOG_PUBLISH]);
    expect((await publisher.call(post, PATH, { method: "POST" })).status).toBe(200);
  });
});

describe("rebuildAllProductListings batching", () => {
  it("visits every product exactly once across pages smaller than the catalog", async () => {
    const products = [];
    for (const label of ["a", "b", "c", "d", "e"]) products.push(await seedLegacyProduct(label));

    const result = await rebuildAllProductListings(2);

    expect(result).toEqual({ processed: 5, batches: 3 });
    for (const product of products) expect((await listingOf(product._id))?.availableOptions).toEqual(["size:s"]);
  });
});
