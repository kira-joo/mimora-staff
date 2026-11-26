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
const searchRoute = (await import("./search/route")).GET as unknown as Handler;

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
  return { status: response.status, body: await response.json() };
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
    expect(body.data.map((p: { slug: string }) => p.slug)).toEqual(["linen-cheap", "cotton-dear"]);
    expect(body.data[0].listing.minActivePrice).toBe("10");
  });

  it("price_desc puts the unpriced product last; an unknown sort is a 400", async () => {
    await seed();
    const { body } = await get(productsRoute, "/api/storefront/products?sort=price_desc");
    expect(body.data.map((p: { slug: string }) => p.slug)).toEqual(["cotton-dear", "linen-cheap", "wool-none"]);

    expect((await get(productsRoute, "/api/storefront/products?sort=cheapest")).status).toBe(400);
    expect((await get(productsRoute, "/api/storefront/products?attr=nocolon")).status).toBe(400);
  });
});

describe("GET /api/storefront/products — manual order (the default), newest and oldest", () => {
  /** old (order 2), mid (order 1), new (order 0, unnumbered) — created in that sequence, 1s apart. */
  async function seedArranged() {
    const category = await CategoryModel.create({ slug: "arranged", published: true });
    const mk = async (slug: string, order: number, createdAt: string) => {
      const created = await ProductModel.create({ slug, categoryId: category._id, lifecycle: "published", order, name: { en: slug, ar: slug } });
      await ProductModel.collection.updateOne({ _id: created._id }, { $set: { createdAt: new Date(createdAt) } });
    };
    await mk("old", 2, "2026-01-01T00:00:00Z");
    await mk("mid", 1, "2026-02-01T00:00:00Z");
    await mk("new", 0, "2026-03-01T00:00:00Z");
  }
  const slugs = (body: { data: Array<{ slug: string }> }) => body.data.map((p) => p.slug);

  it("with no sort the listing is the manual order (order asc), not newest", async () => {
    await seedArranged();
    expect(slugs((await get(productsRoute, "/api/storefront/products")).body)).toEqual(["new", "mid", "old"]);
    expect(slugs((await get(productsRoute, "/api/storefront/products?sort=manual")).body)).toEqual(["new", "mid", "old"]);
  });

  it("when every product is unnumbered (order 0) the default reads newest first, exactly as before manual ordering", async () => {
    await seedArranged();
    await ProductModel.updateMany({}, { $set: { order: 0 } });
    expect(slugs((await get(productsRoute, "/api/storefront/products")).body)).toEqual(["new", "mid", "old"]);
  });

  it("manual follows an arrangement, not age", async () => {
    await seedArranged();
    await ProductModel.updateOne({ slug: "new" }, { $set: { order: 3 } });
    expect(slugs((await get(productsRoute, "/api/storefront/products")).body)).toEqual(["mid", "old", "new"]);
  });

  it("newest and oldest stay available explicitly, whatever the manual order", async () => {
    await seedArranged();
    expect(slugs((await get(productsRoute, "/api/storefront/products?sort=newest")).body)).toEqual(["new", "mid", "old"]);
    expect(slugs((await get(productsRoute, "/api/storefront/products?sort=oldest")).body)).toEqual(["old", "mid", "new"]);
  });

  it("an explicit sortBy still passes through (and no longer defaults to manual)", async () => {
    await seedArranged();
    expect(slugs((await get(productsRoute, "/api/storefront/products?sortBy=slug&sortOrder=ASC")).body)).toEqual(["mid", "new", "old"]);
  });

  it("paginates the manual order consistently and search defaults to it too", async () => {
    await seedArranged();
    const first = await get(productsRoute, "/api/storefront/products?limit=2&page=1");
    const second = await get(productsRoute, "/api/storefront/products?limit=2&page=2");
    expect([...slugs(first.body), ...slugs(second.body)]).toEqual(["new", "mid", "old"]);
    expect(first.body.total).toBe(3);
    expect(Object.keys(first.body).sort()).toEqual(["data", "limit", "page", "total", "totalPages"]);
    expect(slugs((await get(searchRoute, "/api/storefront/search?q=")).body)).toEqual(["new", "mid", "old"]);
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
