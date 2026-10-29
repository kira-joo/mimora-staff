import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { toMoney } from "@kira-joo/toolkit-common";
import { connectToDatabase } from "src/server/core/db/connect";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const productsRoute = (await import("./products/route")).GET as unknown as Handler;
const facetsRoute = (await import("./facets/route")).GET as unknown as Handler;

beforeAll(async () => {
  await connectToDatabase();
});
afterEach(async () => {
  await Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({})]);
});
afterAll(async () => {
  await mongoose.disconnect();
});

const get = async (handler: Handler, path: string) => {
  const response = await handler(new NextRequest(`http://localhost${path}`), { params: Promise.resolve({}) });
  return { status: response.status, body: (await response.json()) as any };
};
const attr = (key: string, valueKey: string) => ({ key, name: { en: key, ar: key }, values: [{ key: valueKey, value: { en: valueKey, ar: valueKey } }] });

async function seed() {
  const parent = await CategoryModel.create({ slug: "parent", published: true });
  const child = await CategoryModel.create({ slug: "child", parentId: parent._id, published: true });
  const mk = (slug: string, price: string | undefined, material: string, categoryId = child._id) =>
    ProductModel.create({
      slug,
      categoryId,
      lifecycle: "published",
      name: { en: slug, ar: slug },
      attributes: [attr("material", material)],
      listing: { minActivePrice: price ? toMoney(price) : undefined, maxActivePrice: price ? toMoney(price) : undefined, purchasableVariantCount: price ? 1 : 0 },
    });
  await mk("cotton-dear", "50.00", "cotton");
  await mk("linen-cheap", "10.00", "linen");
  await mk("wool-none", undefined, "wool");
  return { parent };
}

describe("GET /api/storefront/products — listing capabilities contract", () => {
  it("accepts repeated attr (OR within a key), sort and a parent categoryId; keeps the paginated shape", async () => {
    const { parent } = await seed();

    const { status, body } = await get(productsRoute, `/api/storefront/products?categoryId=${parent._id}&attr=material:cotton&attr=material:linen&sort=price_asc`);

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["data", "limit", "page", "total", "totalPages"]);
    expect(body.data.map((p: any) => p.slug)).toEqual(["linen-cheap", "cotton-dear"]);
    expect(body.data[0].listing.minActivePrice).toBe("10");
  });

  it("price_desc puts the unpriced product last; an unknown sort is a 400", async () => {
    await seed();
    const { body } = await get(productsRoute, "/api/storefront/products?sort=price_desc");
    expect(body.data.map((p: any) => p.slug)).toEqual(["cotton-dear", "linen-cheap", "wool-none"]);

    expect((await get(productsRoute, "/api/storefront/products?sort=cheapest")).status).toBe(400);
    expect((await get(productsRoute, "/api/storefront/products?attr=nocolon")).status).toBe(400);
  });
});

describe("GET /api/storefront/facets — scoped contract", () => {
  it("keeps its shape and counts only the requested scope", async () => {
    const { parent } = await seed();
    const other = await CategoryModel.create({ slug: "other", published: true });
    await ProductModel.create({ slug: "stray", categoryId: other._id, lifecycle: "published", name: { en: "stray", ar: "stray" } });

    const whole = await get(facetsRoute, "/api/storefront/facets");
    expect(Object.keys(whole.body).sort()).toEqual(["attributes", "brands", "categories", "inStockCount", "options", "priceRange"]);
    expect(whole.body.categories).toHaveLength(2);

    const scoped = await get(facetsRoute, `/api/storefront/facets?categoryId=${parent._id}`);
    expect(scoped.body.categories).toHaveLength(1);
    expect(scoped.body.categories[0].count).toBe(3);
  });
});
