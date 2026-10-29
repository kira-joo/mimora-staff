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

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const productsRoute = (await import("../../app/api/storefront/products/route")).GET as unknown as Handler;
const facetsRoute = (await import("../../app/api/storefront/facets/route")).GET as unknown as Handler;

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

async function seed(slug: string, variants: Array<{ sku: string; size: string; stock: number; lowStockThreshold?: number; backorderPolicy?: "DENY" | "CONTINUE_SELLING" }>) {
  const category = (await CategoryModel.findOne({ slug: "c" })) ?? (await CategoryModel.create({ slug: "c", published: true }));
  const product = await ProductModel.create({ slug, categoryId: category._id, lifecycle: "published", name: { en: slug, ar: slug } });
  for (const variant of variants) {
    await VariantModel.create({ productId: product._id, sku: variant.sku, variantKey: `${product._id}|${variant.sku}`, price: toMoney("10.00"), optionValues: [{ key: "size", value: variant.size }], stock: variant.stock, lowStockThreshold: variant.lowStockThreshold, backorderPolicy: variant.backorderPolicy });
  }
  await withTransaction(async (tx) => {
    await maintainProductListingRollup(product._id);
    return tx.complete(undefined);
  });
}

describe("GET /api/storefront/products — option, in-stock and low-stock contract", () => {
  it("accepts repeated opt and inStock=true, rejects a malformed opt", async () => {
    await seed("has-m", [{ sku: "A", size: "m", stock: 5 }]);
    await seed("sold-out-m", [{ sku: "B", size: "m", stock: 0 }]);
    await seed("has-s", [{ sku: "C", size: "s", stock: 5 }]);

    const both = await get(productsRoute, "/api/storefront/products?opt=size:m&opt=size:s");
    expect(both.status).toBe(200);
    expect(both.body.data.map((p: any) => p.slug).sort()).toEqual(["has-m", "has-s"]);

    const inStock = await get(productsRoute, "/api/storefront/products?inStock=true");
    expect(inStock.body.data.map((p: any) => p.slug).sort()).toEqual(["has-m", "has-s"]);
    expect(inStock.body.total).toBe(2);

    const notFiltered = await get(productsRoute, "/api/storefront/products?inStock=false");
    expect(notFiltered.body.total).toBe(3);

    expect((await get(productsRoute, "/api/storefront/products?opt=nocolon")).status).toBe(400);
    expect((await get(productsRoute, "/api/storefront/products?inStock=maybe")).status).toBe(400);
  });

  it("facets carry options with counts and the in-stock count", async () => {
    await seed("a", [{ sku: "A", size: "m", stock: 5 }]);
    await seed("b", [{ sku: "B", size: "m", stock: 0 }]);

    const { status, body } = await get(facetsRoute, "/api/storefront/facets");
    expect(status).toBe(200);
    expect(body.inStockCount).toBe(1);
    expect(body.options).toEqual([{ key: "size", name: { ar: "size", en: "size" }, values: [{ key: "m", label: { ar: "m", en: "m" }, count: 1 }] }]);
  });

  it("each listing product carries a boolean lowStock and none of the rollup's raw low-stock facts", async () => {
    await seed("few", [{ sku: "F", size: "m", stock: 3 }]);
    await seed("plenty", [{ sku: "P", size: "m", stock: 50 }]);

    const { body } = await get(productsRoute, "/api/storefront/products");
    const bySlug = Object.fromEntries(body.data.map((p: any) => [p.slug, p.listing]));
    expect(bySlug.few.lowStock).toBe(true); // 3 <= the default threshold of 5
    expect(bySlug.plenty.lowStock).toBe(false);
    for (const listing of Object.values(bySlug) as any[]) {
      expect(listing).not.toHaveProperty("lowStockOverride");
      expect(listing).not.toHaveProperty("minTrackedStock");
      expect(typeof listing.minActivePrice).toBe("string"); // money still serialises as before
    }
  });

  it("follows a changed store-wide threshold with no rollup recompute", async () => {
    await seed("eight", [{ sku: "E", size: "m", stock: 8 }]);
    const lowStock = async () => (await get(productsRoute, "/api/storefront/products")).body.data[0].listing.lowStock;

    expect(await lowStock()).toBe(false); // default threshold 5
    await InventorySettingsModel.create({ lowStockThreshold: 10 });
    expect(await lowStock()).toBe(true);
  });

  it("a variant's own threshold wins over the store-wide one, and a backorderable variant is never low", async () => {
    await seed("override", [{ sku: "O", size: "m", stock: 20, lowStockThreshold: 25 }]);
    await seed("backorder", [{ sku: "B", size: "m", stock: 1, backorderPolicy: "CONTINUE_SELLING" }]);
    await seed("sold-out", [{ sku: "S", size: "m", stock: 0 }]);

    const { body } = await get(productsRoute, "/api/storefront/products");
    const bySlug = Object.fromEntries(body.data.map((p: any) => [p.slug, p.listing.lowStock]));
    expect(bySlug).toEqual({ override: true, backorder: false, "sold-out": false });
  });
});
