import mongoose from "mongoose";
import { toMoney, type ImageAsset } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { getProductDetail } from "src/server/storefront/get-product-detail";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../../../test-support/admin-route-harness";

/**
 * Product contents ("what's inside" a gift box) through their real routes (auth, permissions, DTO validation,
 * transaction, revalidation) against a real database, and what the storefront then shows. Only the storefront's
 * revalidation receiver is stubbed.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../../../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

type Routes = Record<"GET" | "POST" | "PUT" | "DELETE", RouteHandler>;
const contentsRoute = (await import("./route")) as unknown as Routes;
const product = (await import("../route")) as unknown as Routes;
const lifecycle = (await import("../lifecycle/route")) as unknown as Routes;

const L = (en: string, ar: string) => ({ en, ar });
const image = (publicId: string): ImageAsset => ({ provider: "cloudinary" as ImageAsset["provider"], publicId, secureUrl: `https://res.example/${publicId}.png`, format: "png", width: 400, height: 400, bytes: 1000 });
const realFetch = globalThis.fetch;
const revalidations: string[][] = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

let owner: AdminCaller;
let categoryId: mongoose.Types.ObjectId;
const wipe = () => Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([wipe(), removeHarnessStaff()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await wipe();
  categoryId = (await CategoryModel.create({ slug: "gifts", published: true }))._id;
  revalidations.length = 0;
  process.env.STOREFRONT_REVALIDATE_URL = "http://storefront.test/api/revalidate";
  process.env.REVALIDATE_SECRET = "test-revalidate-secret";
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("http://storefront.test/")) {
      revalidations.push((JSON.parse(String(init?.body)) as { tags: string[] }).tags);
      return new Response(null, { status: 200 });
    }
    return realFetch(url, init);
  });
});
afterEach(() => vi.unstubAllGlobals());

/** A real, complete product with its own variants, gallery and price — what a contents change must never touch. */
async function seedProduct(slug: string, lifecycleState: "draft" | "published" | "archived" = "published", extra: Record<string, unknown> = {}) {
  const created = await ProductModel.create({
    slug,
    categoryId,
    lifecycle: lifecycleState,
    name: L(`${slug} item`, `قطعة ${slug}`),
    description: L("Nice.", "جميل."),
    images: [image(`mimora/products/${slug}`), image(`mimora/products/${slug}-2`)],
    optionAxes: [{ key: "size", name: L("Size", "المقاس") }],
    ...extra,
  });
  await VariantModel.create([
    { productId: created._id, sku: `${slug}-S`, variantKey: `${slug}-s`, optionValues: [{ key: "size", value: "S" }], price: toMoney("250.00"), stock: 3 },
    { productId: created._id, sku: `${slug}-M`, variantKey: `${slug}-m`, optionValues: [{ key: "size", value: "M" }], price: toMoney("260.00"), stock: 0 },
  ]);
  return created._id.toString();
}

const json = async (response: Response) => ({ status: response.status, body: response.status === 204 ? null : await response.json() });
const readContents = async (id: string, caller = owner) => json(await caller.call(contentsRoute.GET, `/api/admin/products/${id}/contents`, { params: { id } }));
const setContents = async (id: string, items: unknown, caller = owner) =>
  json(await caller.call(contentsRoute.PUT, `/api/admin/products/${id}/contents`, { method: "PUT", params: { id }, body: { items } }));
const stored = async (id: string) => ProductModel.findById(id).lean();
const updatedAt = async (id: string) => ((await stored(id)) as unknown as { updatedAt?: Date }).updatedAt;
/** Everything about a product except `contents` — must not change when contents change. */
const productFacts = async (id: string) => {
  const rest = { ...(await stored(id))! } as Record<string, unknown>;
  delete rest.contents;
  return { product: rest, variants: await VariantModel.find({ productId: id }).sort({ sku: 1 }).lean() };
};
const slugs = (items: Array<{ slug: string; quantity: number }>) => items.map((item) => [item.slug, item.quantity]);

describe("setting and reading contents", () => {
  it("stores items in order with quantities, returns the live read view, leaves every box and item field alone, publishes PRODUCTS once", async () => {
    const box = await seedProduct("box");
    const [a, b, c] = [await seedProduct("a"), await seedProduct("b", "draft"), await seedProduct("c")];
    const before = await Promise.all([box, a, b, c].map(productFacts));

    const saved = await setContents(box, [
      { productId: c, quantity: 1 },
      { productId: a, quantity: 3 },
      { productId: b, quantity: 2 },
    ]);

    expect(saved.status).toBe(200);
    expect(saved.body.productId).toBe(box);
    expect(saved.body.items.map((i: { productId: string; slug: string; lifecycle: string; quantity: number }) => [i.productId, i.slug, i.lifecycle, i.quantity])).toEqual([
      [c, "c", "published", 1],
      [a, "a", "published", 3],
      [b, "b", "draft", 2],
    ]);
    expect(saved.body.items[0]).toMatchObject({ name: L("c item", "قطعة c"), image: { publicId: "mimora/products/c" } });
    expect(await Promise.all([box, a, b, c].map(productFacts))).toEqual(before);
    expect((await readContents(box)).body).toEqual(saved.body);
    await vi.waitFor(() => expect(revalidations).toEqual([["PRODUCTS"]]));
  });

  it("does not move the box's updatedAt (an open product form is not reset)", async () => {
    const box = await seedProduct("box");
    const a = await seedProduct("a");
    const before = await updatedAt(box);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await setContents(box, [{ productId: a, quantity: 1 }]);
    expect(await updatedAt(box)).toEqual(before);
  });

  it("replaces the whole list, and an empty list clears it", async () => {
    const box = await seedProduct("box");
    const [a, b] = [await seedProduct("a"), await seedProduct("b")];
    await setContents(box, [{ productId: a, quantity: 1 }, { productId: b, quantity: 1 }]);
    expect(slugs((await setContents(box, [{ productId: b, quantity: 5 }])).body.items)).toEqual([["b", 5]]);
    const cleared = await setContents(box, []);
    expect(cleared.status).toBe(200);
    expect(cleared.body.items).toEqual([]);
    expect((await stored(box))?.contents).toBeUndefined();
  });

  it("a product with no contents reads as an empty list", async () => {
    const box = await seedProduct("box");
    expect((await readContents(box)).body).toEqual({ productId: box, items: [] });
  });

  it("allows nesting (an included product that itself has contents)", async () => {
    const [outer, middle, inner] = [await seedProduct("outer"), await seedProduct("middle"), await seedProduct("inner")];
    expect((await setContents(middle, [{ productId: inner, quantity: 1 }])).status).toBe(200);
    expect((await setContents(outer, [{ productId: middle, quantity: 1 }])).status).toBe(200);
  });

  it("the reads skip an included product that no longer exists (defensive)", async () => {
    const box = await seedProduct("box");
    const [a, b] = [await seedProduct("a"), await seedProduct("b")];
    await setContents(box, [{ productId: a, quantity: 1 }, { productId: b, quantity: 2 }]);
    await ProductModel.deleteOne({ _id: a });
    expect(slugs((await readContents(box)).body.items)).toEqual([["b", 2]]);
  });

  it("an unknown box is a 404 for both read and write", async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const a = await seedProduct("a");
    expect((await readContents(ghost)).status).toBe(404);
    expect((await setContents(ghost, [{ productId: a, quantity: 1 }])).status).toBe(404);
    await settle();
    expect(revalidations).toEqual([]);
  });
});

describe("refusals write nothing and publish nothing", () => {
  async function seededBox() {
    const box = await seedProduct("box");
    const [a, b] = [await seedProduct("a"), await seedProduct("b")];
    await setContents(box, [{ productId: a, quantity: 2 }]);
    await settle();
    revalidations.length = 0;
    return { box, a, b };
  }
  const unchanged = async (box: string, a: string) => {
    expect((await stored(box))?.contents?.map((c) => [c.productId.toString(), c.quantity])).toEqual([[a, 2]]);
    await settle();
    expect(revalidations).toEqual([]);
  };

  it("self-inclusion is a 400", async () => {
    const { box, a } = await seededBox();
    expect((await setContents(box, [{ productId: box, quantity: 1 }])).status).toBe(400);
    await unchanged(box, a);
  });

  it("a duplicate product is a 400", async () => {
    const { box, a, b } = await seededBox();
    expect((await setContents(box, [{ productId: b, quantity: 1 }, { productId: b, quantity: 2 }])).status).toBe(400);
    await unchanged(box, a);
  });

  it.each([0, 100, -3, 1.5, "2", null])("quantity %j is a 400", async (quantity) => {
    const { box, a, b } = await seededBox();
    expect((await setContents(box, [{ productId: b, quantity }])).status).toBe(400);
    await unchanged(box, a);
  });

  it("a malformed product id, a non-array body and more than 20 items are 400s", async () => {
    const { box, a } = await seededBox();
    expect((await setContents(box, [{ productId: "not-an-id", quantity: 1 }])).status).toBe(400);
    expect((await setContents(box, "nope")).status).toBe(400);
    const many = await Promise.all(Array.from({ length: 21 }, async (_, i) => ({ productId: await seedProduct(`m${i}`), quantity: 1 })));
    expect((await setContents(box, many)).status).toBe(400);
    await unchanged(box, a);
  });

  it("an included product that does not exist is a 404 and nothing is written (even for the valid ones)", async () => {
    const { box, a, b } = await seededBox();
    const ghost = new mongoose.Types.ObjectId().toString();
    const refused = await setContents(box, [{ productId: b, quantity: 1 }, { productId: ghost, quantity: 1 }]);
    expect(refused.status).toBe(404);
    expect(JSON.stringify(refused.body)).toContain("1 of the included products");
    await unchanged(box, a);
  });
});

describe("permissions", () => {
  it.each([
    ["no permissions", []],
    ["read only", [AppPermission.PRODUCT.READ, AppPermission.PRODUCT.READ_ONE]],
  ])("NEGATIVE: %s cannot change contents (403), and nothing changes or publishes", async (_label, keys) => {
    const box = await seedProduct("box");
    const a = await seedProduct("a");
    const staff = await signInWithPermissions(keys);
    expect((await setContents(box, [{ productId: a, quantity: 1 }], staff)).status).toBe(403);
    expect((await stored(box))?.contents).toBeUndefined();
    await settle();
    expect(revalidations).toEqual([]);
    owner = await signInAsOwner();
  });

  it("NEGATIVE: without PRODUCT.READ_ONE the contents cannot be read (403)", async () => {
    const box = await seedProduct("box");
    const staff = await signInWithPermissions([AppPermission.PRODUCT.UPDATE]);
    expect((await readContents(box, staff)).status).toBe(403);
    owner = await signInAsOwner();
  });

  it("PRODUCT.READ_ONE reads and PRODUCT.UPDATE writes", async () => {
    const box = await seedProduct("box");
    const a = await seedProduct("a");
    const staff = await signInWithPermissions([AppPermission.PRODUCT.READ_ONE, AppPermission.PRODUCT.UPDATE]);
    expect((await setContents(box, [{ productId: a, quantity: 2 }], staff)).status).toBe(200);
    expect(slugs((await readContents(box, staff)).body.items)).toEqual([["a", 2]]);
    owner = await signInAsOwner();
  });
});

describe("what the storefront shows", () => {
  it("a product without contents has includedProducts []", async () => {
    await seedProduct("plain");
    const detail = await getProductDetail("plain");
    expect(detail.includedProducts).toEqual([]);
    expect(detail.linkedProducts).toBeNull();
  });

  it("shows only PUBLISHED included products, in stored order, with quantities and up to six images", async () => {
    const box = await seedProduct("box");
    const many = await seedProduct("many", "published", { images: Array.from({ length: 8 }, (_, i) => image(`many-${i}`)) });
    const [first, draft, archived] = [await seedProduct("first"), await seedProduct("draft", "draft"), await seedProduct("old", "archived")];
    await setContents(box, [
      { productId: many, quantity: 2 },
      { productId: draft, quantity: 1 },
      { productId: first, quantity: 4 },
      { productId: archived, quantity: 1 },
    ]);

    const detail = await getProductDetail("box");
    expect(slugs(detail.includedProducts)).toEqual([["many", 2], ["first", 4]]);
    expect(detail.includedProducts[0].images).toHaveLength(6);
    expect(detail.includedProducts[1].images.map((i) => (i as unknown as { publicId: string }).publicId)).toEqual(["mimora/products/first", "mimora/products/first-2"]);
    // The box itself is untouched and still reports its own variants.
    expect(detail.variants).toHaveLength(2);
  });

  it("is LIVE: renaming an included product, and publishing a draft one, shows on the box without touching the box", async () => {
    const box = await seedProduct("box");
    const [a, b] = [await seedProduct("a"), await seedProduct("b", "draft")];
    await setContents(box, [{ productId: a, quantity: 1 }, { productId: b, quantity: 1 }]);
    const boxBefore = await productFacts(box);
    const boxUpdatedAt = await updatedAt(box);
    expect((await getProductDetail("box")).includedProducts.map((i) => i.name.en)).toEqual(["a item"]);

    const renamed = await json(
      await owner.call(product.PUT, `/api/admin/products/${a}`, { method: "PUT", params: { id: a }, body: { name: L("Renamed rose", "وردة جديدة"), images: [image("new-main")] } })
    );
    expect(renamed.status).toBe(200);
    const published = await json(await owner.call(lifecycle.PUT, `/api/admin/products/${b}/lifecycle`, { method: "PUT", params: { id: b }, body: { lifecycle: "published" } }));
    expect(published.status).toBe(200);

    const detail = await getProductDetail("box");
    expect(detail.includedProducts.map((i) => [i.slug, i.name.en, i.name.ar])).toEqual([
      ["a", "Renamed rose", "وردة جديدة"],
      ["b", "b item", "قطعة b"],
    ]);
    expect(detail.includedProducts[0].images.map((i) => (i as unknown as { publicId: string }).publicId)).toEqual(["new-main"]);
    expect(await productFacts(box)).toEqual(boxBefore);
    expect(await updatedAt(box)).toEqual(boxUpdatedAt);
    // Both included-product mutations publish PRODUCTS, which is what refreshes the box's cached page.
    await vi.waitFor(() => expect(revalidations.filter((tags) => tags.includes("PRODUCTS")).length).toBeGreaterThanOrEqual(2));
  });
});
