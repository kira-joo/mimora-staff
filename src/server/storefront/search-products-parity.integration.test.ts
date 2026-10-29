import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { maintainProductListingRollup } from "src/server/catalog/rollups/maintain-product-listing";
import { connectToDatabase } from "src/server/core/db/connect";
import { InventorySettingsModel } from "src/server/fulfilment/inventory-settings.schema";

/**
 * `/api/storefront/search` is the listing with a term: it must honour `inStock`, `opt` and the `lowStock` projection
 * exactly as `/api/storefront/products` does — same port, same builder, same card shape. Every case below runs the
 * SAME query through both routes and compares them, so the two cannot drift.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const productsRoute = (await import("../../app/api/storefront/products/route")).GET as unknown as Handler;
const searchRoute = (await import("../../app/api/storefront/search/route")).GET as unknown as Handler;

beforeAll(async () => {
  await connectToDatabase();
});
const clean = () => Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({}), VariantModel.deleteMany({}), InventorySettingsModel.deleteMany({})]);
afterEach(clean);
afterAll(async () => {
  await clean();
  await mongoose.disconnect();
});

const get = async (handler: Handler, path: string) => {
  const response = await handler(new NextRequest(`http://localhost${path}`), { params: Promise.resolve({}) });
  return { status: response.status, body: (await response.json()) as any };
};
const slugs = (body: any) => body.data.map((p: any) => p.slug).sort();

async function seed(slug: string, variants: Array<{ sku: string; size: string; stock: number }>) {
  const category = (await CategoryModel.findOne({ slug: "c" })) ?? (await CategoryModel.create({ slug: "c", published: true }));
  const product = await ProductModel.create({ slug, categoryId: category._id, lifecycle: "published", name: { en: `Shirt ${slug}`, ar: `قميص ${slug}` } });
  for (const variant of variants) {
    await VariantModel.create({ productId: product._id, sku: variant.sku, variantKey: `${product._id}|${variant.sku}`, price: toMoney("10.00"), optionValues: [{ key: "size", value: variant.size }], stock: variant.stock });
  }
  await withTransaction(async (tx) => {
    await maintainProductListingRollup(product._id);
    return tx.complete(undefined);
  });
}

async function seedCatalog() {
  await seed("has-m", [{ sku: "A", size: "m", stock: 5 }]);
  await seed("sold-out-m", [{ sku: "B", size: "m", stock: 0 }]);
  await seed("has-s", [{ sku: "C", size: "s", stock: 2 }]);
}

describe("GET /api/storefront/search — parity with the listing", () => {
  it("inStock=true drops a product whose only variants are sold out", async () => {
    await seedCatalog();
    const search = await get(searchRoute, "/api/storefront/search?q=Shirt&inStock=true");
    expect(search.status).toBe(200);
    expect(slugs(search.body)).toEqual(["has-m", "has-s"]);
    expect(search.body.total).toBe(2);
    // Without the filter the sold-out product is there, so the filter is what removed it.
    expect(slugs((await get(searchRoute, "/api/storefront/search?q=Shirt")).body)).toEqual(["has-m", "has-s", "sold-out-m"]);
  });

  it("repeated opt filters apply (OR within an axis, over purchasable variants only)", async () => {
    await seedCatalog();
    expect(slugs((await get(searchRoute, "/api/storefront/search?q=Shirt&opt=size:m")).body)).toEqual(["has-m"]);
    expect(slugs((await get(searchRoute, "/api/storefront/search?q=Shirt&opt=size:m&opt=size:s")).body)).toEqual(["has-m", "has-s"]);
  });

  it("rejects a malformed opt exactly as the listing does", async () => {
    expect((await get(searchRoute, "/api/storefront/search?q=Shirt&opt=nocolon")).status).toBe(400);
    expect((await get(productsRoute, "/api/storefront/products?opt=nocolon")).status).toBe(400);
  });

  it("projects lowStock as a boolean and never leaks the rollup's raw stock facts", async () => {
    await seedCatalog();
    const { body } = await get(searchRoute, "/api/storefront/search?q=Shirt");
    const bySlug = Object.fromEntries(body.data.map((p: any) => [p.slug, p.listing]));
    expect(bySlug["has-s"].lowStock).toBe(true); // 2 <= the default threshold of 5
    expect(bySlug["has-m"].lowStock).toBe(true);
    for (const listing of Object.values(bySlug) as any[]) {
      expect(typeof listing.lowStock).toBe("boolean");
      expect(listing).not.toHaveProperty("lowStockOverride");
      expect(listing).not.toHaveProperty("minTrackedStock");
    }
  });

  it("follows the store-wide low-stock threshold, as the listing does", async () => {
    await seedCatalog();
    await InventorySettingsModel.create({ lowStockThreshold: 1 });
    const { body } = await get(searchRoute, "/api/storefront/search?q=Shirt&inStock=true");
    expect(body.data.map((p: any) => p.listing.lowStock)).toEqual([false, false]);
  });

  it.each([
    "inStock=true",
    "opt=size:m",
    "opt=size:s&inStock=true",
    "sort=price_asc&limit=2",
  ])("returns the same page as the listing for %s", async (filters) => {
    await seedCatalog();
    const search = await get(searchRoute, `/api/storefront/search?q=Shirt&${filters}`);
    const listing = await get(productsRoute, `/api/storefront/products?search=Shirt&${filters}`);
    expect(search.status).toBe(200);
    expect(search.body).toEqual(listing.body);
  });

  it("still requires q", async () => {
    expect((await get(searchRoute, "/api/storefront/search")).status).toBe(400);
  });
});
