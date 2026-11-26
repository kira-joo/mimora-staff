import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { CategoryModel } from "src/server/catalog/category.schema";
import { CollectionModel } from "src/server/catalog/collection.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { createProduct } from "src/server/admin/products/create-product";
import { listProducts } from "src/server/admin/products/list-products";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../../test-support/admin-route-harness";

/**
 * Manual product ordering through its real route (auth, permissions, DTO validation, transaction, revalidation) against
 * a real database: an arrangement is scoped (a category with its descendants, or a collection), never moves anything
 * outside its scope, refuses a stale list with nothing written, and a new product is appended after it.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const route = (await import("./route")) as unknown as Record<"GET" | "PUT", RouteHandler>;

const L = (en: string) => ({ en, ar: `${en} ع` });
const realFetch = globalThis.fetch;
const revalidations: string[][] = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

let owner: AdminCaller;
let parent: mongoose.Types.ObjectId;
let child: mongoose.Types.ObjectId; // UNPUBLISHED descendant of `parent`
let other: mongoose.Types.ObjectId;
let collection: mongoose.Types.ObjectId;
let clock = 0;

const wipe = () => Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({}), CollectionModel.deleteMany({})]);

/** Products get strictly increasing createdAt, so the canonical tie-break (newest first) is predictable. */
async function seed(slug: string, categoryId: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) {
  clock += 1000;
  const created = await ProductModel.create({ slug, categoryId, lifecycle: "published", name: L(slug), description: L(""), ...extra });
  await ProductModel.collection.updateOne({ _id: created._id }, { $set: { createdAt: new Date(1_700_000_000_000 + clock) } });
  return created._id.toString();
}

const storedOrder = async () => Object.fromEntries((await ProductModel.find({}).lean()).map((p) => [p.slug, p.order]));
/** Every product, in the canonical manual order, by slug (the public list's default). */
const manualSlugs = async () => (await listProducts({ page: 1, limit: 100 })).data.map((p) => p.slug);
const put = (body: unknown, caller: AdminCaller = owner) => caller.call(route.PUT, "/api/admin/products/order", { method: "PUT", body });
const get = async (search = "", caller: AdminCaller = owner) => {
  const response = await caller.call(route.GET, `/api/admin/products/order${search}`);
  return { status: response.status, body: (await response.json()) as Array<{ _id: string; slug: string }> & { message?: string } };
};

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
  clock = 0;
  parent = (await CategoryModel.create({ slug: "parent", published: true }))._id;
  child = (await CategoryModel.create({ slug: "child", parentId: parent, published: false }))._id;
  other = (await CategoryModel.create({ slug: "other", published: true }))._id;
  collection = (await CollectionModel.create({ slug: "gifts", name: L("Gifts") }))._id;
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

describe("GET /api/admin/products/order", () => {
  it("lists the whole catalogue (never archived) in the canonical order: order asc, ties newest first", async () => {
    await seed("old", other); // order 0, oldest
    await seed("new", other); // order 0, newest
    await seed("first", other, { order: 1 });
    await seed("gone", other, { lifecycle: "archived" });

    const { status, body } = await get();
    expect(status).toBe(200);
    // order 0 sorts before order 1: the two unnumbered products lead, newest first
    expect(body.map((p) => p.slug)).toEqual(["new", "old", "first"]);
  });

  it("returns a light projection", async () => {
    await seed("a", other);
    const { body } = await get();
    expect(Object.keys(body[0]!).sort()).toEqual(["_id", "categoryId", "lifecycle", "listing", "name", "slug"]);
  });

  it("a category scope includes its descendants (even an unpublished one) and nothing else; a collection scope is its members", async () => {
    await seed("in-parent", parent);
    await seed("in-child", child);
    await seed("in-other", other);
    await seed("in-collection", other, { collectionIds: [collection] });

    expect((await get(`?categoryId=${parent}`)).body.map((p) => p.slug).sort()).toEqual(["in-child", "in-parent"]);
    expect((await get(`?categoryId=${child}`)).body.map((p) => p.slug)).toEqual(["in-child"]);
    expect((await get(`?collectionId=${collection}`)).body.map((p) => p.slug)).toEqual(["in-collection"]);
  });

  it("is a 400 when both a category and a collection are given, and a 404 for an unknown scope", async () => {
    expect((await get(`?categoryId=${parent}&collectionId=${collection}`)).status).toBe(400);
    expect((await get(`?categoryId=${new mongoose.Types.ObjectId()}`)).status).toBe(404);
    expect((await get("?categoryId=nope")).status).toBe(400);
  });
});

describe("PUT /api/admin/products/order", () => {
  it("persists a whole-catalogue arrangement as 1..N, and the default list then reads in that order", async () => {
    const a = await seed("a", other);
    const b = await seed("b", other);
    const c = await seed("c", other);

    const response = await put({ productIds: [b, c, a] });
    expect(response.status).toBeLessThan(300);
    expect(await response.json()).toEqual({ updated: 3 });
    expect(await storedOrder()).toEqual({ b: 1, c: 2, a: 3 });
    expect(await manualSlugs()).toEqual(["b", "c", "a"]);
    expect((await get()).body.map((p) => p.slug)).toEqual(["b", "c", "a"]);

    await settle();
    expect(revalidations.flat()).toContain("PRODUCTS");
  });

  it("writes only what changes: re-saving the same arrangement updates 0", async () => {
    const a = await seed("a", other);
    const b = await seed("b", other);
    await put({ productIds: [b, a] });
    const before = await ProductModel.find({}).lean();

    expect(await (await put({ productIds: [b, a] })).json()).toEqual({ updated: 0 });
    expect(await ProductModel.find({}).lean()).toEqual(before);
  });

  it("does not touch updatedAt, so an open product form is not reset", async () => {
    const a = await seed("a", other);
    const b = await seed("b", other);
    const updatedAt = async () => ((await ProductModel.findById(a).lean()) as unknown as { updatedAt: Date }).updatedAt;
    const before = await updatedAt();
    await put({ productIds: [b, a] });
    expect(await updatedAt()).toEqual(before);
  });

  it("a category scope reorders only its members; every other product keeps its place", async () => {
    // Global order (all order 0 => newest first): z-other-2, c3, z-other-1, c2, c1
    const c1 = await seed("c1", parent);
    const c2 = await seed("c2", child);
    const o1 = await seed("o1", other);
    const c3 = await seed("c3", parent);
    await seed("o2", other);
    expect(await manualSlugs()).toEqual(["o2", "c3", "o1", "c2", "c1"]);

    // Arrange parent's tree (c3, c2, c1) as c1, c3, c2: it keeps the slots 2, 4, 5 the tree occupied.
    const response = await put({ categoryId: parent.toString(), productIds: [c1, c3, c2] });
    expect(response.status).toBeLessThan(300);

    expect(await manualSlugs()).toEqual(["o2", "c1", "o1", "c3", "c2"]);
    // The other category's relative order (o2 before o1) is untouched.
    const order = await storedOrder();
    expect(order.o2).toBeLessThan(order.o1!);
    expect(await ProductModel.findById(o1).then((p) => p!.categoryId.toString())).toBe(other.toString());
  });

  it("a collection scope reorders only the collection's members", async () => {
    const a = await seed("a", other, { collectionIds: [collection] });
    await seed("x", other);
    const b = await seed("b", other, { collectionIds: [collection] });
    await seed("y", other);
    expect(await manualSlugs()).toEqual(["y", "b", "x", "a"]);

    await put({ collectionId: collection.toString(), productIds: [a, b] });
    expect(await manualSlugs()).toEqual(["y", "a", "x", "b"]);
  });

  it("a stale list is a 409 and nothing is written: a missing, extra or unknown product", async () => {
    const a = await seed("a", other);
    const b = await seed("b", other);
    await seed("c", other);
    const before = await ProductModel.find({}).lean();

    for (const productIds of [[a, b], [a, b, new mongoose.Types.ObjectId().toString()], [a, b, a], []]) {
      const response = await put({ productIds });
      expect([400, 409]).toContain(response.status);
    }
    const stale = await put({ productIds: [a, b] });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { message: string }).message).toMatch(/changed since you opened it/);
    expect(await ProductModel.find({}).lean()).toEqual(before);
  });

  it("a product added after the screen loaded makes the submit a 409", async () => {
    const a = await seed("a", other);
    const b = await seed("b", other);
    await seed("late", other);
    expect((await put({ productIds: [b, a] })).status).toBe(409);
  });

  it("duplicate ids and malformed ids are a 400", async () => {
    const a = await seed("a", other);
    expect((await put({ productIds: [a, a] })).status).toBe(400);
    expect((await put({ productIds: ["nope"] })).status).toBe(400);
    expect((await put({ categoryId: parent.toString(), collectionId: collection.toString(), productIds: [] })).status).toBe(400);
  });

  it("archived products keep their slot: they are neither listed nor renumbered out of place", async () => {
    const a = await seed("a", other, { order: 1 });
    await seed("archived", other, { order: 2, lifecycle: "archived" });
    const c = await seed("c", other, { order: 3 });

    expect(await put({ productIds: [c, a] })).toMatchObject({ status: 200 });
    // Global order was a(1), archived(2), c(3). The scope {a, c} fills positions 1 and 3; archived stays in position 2.
    expect(await storedOrder()).toEqual({ c: 1, archived: 2, a: 3 });
  });

  it("a product created after an arrangement is appended after every product, archived included", async () => {
    const a = await seed("a", other);
    const b = await seed("b", other);
    await seed("archived", other, { lifecycle: "archived" });
    await put({ productIds: [b, a] });
    // The archived product is the newest, so it leads the global order and keeps position 1; the scope fills 2 and 3.
    expect(await storedOrder()).toEqual({ archived: 1, b: 2, a: 3 });

    const created = await createProduct({ name: L("fresh"), description: L(""), slug: "fresh", categoryId: other.toString() });
    expect(created.order).toBe(Math.max(...Object.values(await storedOrder())));
    expect((await manualSlugs()).at(-1)).toBe("fresh");
  });

  it("NEGATIVE: without Product.update the request is refused (403) and nothing is written; Product.read alone may list", async () => {
    const a = await seed("a", other);
    const b = await seed("b", other);
    const before = await ProductModel.find({}).lean();

    const reader = await signInWithPermissions([AppPermission.PRODUCT.READ, AppPermission.PRODUCT.READ_ONE]);
    expect((await put({ productIds: [b, a] }, reader)).status).toBe(403);
    expect(await ProductModel.find({}).lean()).toEqual(before);
    expect((await get("", reader)).status).toBe(200);

    const updater = await signInWithPermissions([AppPermission.PRODUCT.UPDATE]);
    expect((await get("", updater)).status).toBe(403);
    expect((await put({ productIds: [b, a] }, updater)).status).toBeLessThan(300);

    owner = await signInAsOwner();
  });
});

describe("rollback", () => {
  it("a failure after the write leaves no partial arrangement", async () => {
    const a = await seed("a", other);
    const b = await seed("b", other);
    const c = await seed("c", other);
    const before = await ProductModel.find({}).lean();

    const original = ProductModel.bulkWrite.bind(ProductModel);
    // The write lands inside the transaction, then the callback fails before completing.
    const spy = vi.spyOn(ProductModel, "bulkWrite").mockImplementation(async (...args: Parameters<typeof original>) => {
      await original(...args);
      throw new Error("injected failure");
    });
    const response = await put({ productIds: [c, b, a] });
    spy.mockRestore();

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await ProductModel.find({}).lean()).toEqual(before);
  });
});
