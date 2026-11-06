import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { CategoryModel } from "src/server/catalog/category.schema";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/** Category writes through the real DTO pipeline and auth guard: permissions (the negative case), hierarchy refusals as the console receives them, and the reorder bound. */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const collection = await import("./route");
const item = await import("./[id]/route");
const reorderRoute = await import("./reorder/route");
const create = collection.POST as RouteHandler;
const update = item.PUT as RouteHandler;
const remove = item.DELETE as RouteHandler;
const reorder = reorderRoute.PUT as RouteHandler;

const PATH = "/api/admin/categories";
const LABEL = { ar: "فئة", en: "Category" };
let owner: AdminCaller;
let counter = 0;

const wipe = () => CategoryModel.deleteMany({});
beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterEach(wipe);
afterAll(async () => {
  await wipe();
  await removeHarnessStaff();
  await mongoose.disconnect();
});

const json = async (response: Response) => {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
};
const post = (body: Record<string, unknown>, caller = owner) =>
  caller.call(create, PATH, { method: "POST", body: { name: LABEL, description: LABEL, seoTitle: LABEL, seoDescription: LABEL, slug: `route-${(counter += 1)}`, ...body } }).then(json);
const put = (id: string, body: unknown, caller = owner) => caller.call(update, `${PATH}/${id}`, { method: "PUT", params: { id }, body }).then(json);
const del = (id: string, caller = owner) => caller.call(remove, `${PATH}/${id}`, { method: "DELETE", params: { id } }).then(json);
const sort = (items: unknown, caller = owner) => caller.call(reorder, `${PATH}/reorder`, { method: "PUT", body: { items } }).then(json);

describe("DELETE /api/admin/categories/[id] permissions — the negative case", () => {
  it("a signed-in staff member without category delete gets 403, and the category still exists", async () => {
    const category = await CategoryModel.create({ slug: "keep-me" });
    const withoutDelete = await signInWithPermissions([AppPermission.CATEGORY.READ, AppPermission.CATEGORY.READ_ONE, AppPermission.CATEGORY.CREATE, AppPermission.CATEGORY.UPDATE]);

    expect((await del(category._id.toString(), withoutDelete)).status).toBe(403);
    expect(await CategoryModel.countDocuments({ _id: category._id })).toBe(1);
  });

  it("the holder of category delete can delete it", async () => {
    const category = await CategoryModel.create({ slug: "remove-me" });
    const deleter = await signInWithPermissions([AppPermission.CATEGORY.DELETE]);
    expect((await del(category._id.toString(), deleter)).status).toBe(204);
    expect(await CategoryModel.countDocuments({ _id: category._id })).toBe(0);
  });

  it("without category update, a reorder and a move are 403 and change nothing", async () => {
    const category = await CategoryModel.create({ slug: "still", sortOrder: 4 });
    const reader = await signInWithPermissions([AppPermission.CATEGORY.READ]);
    expect((await sort([{ categoryId: category._id.toString(), sortOrder: 1 }], reader)).status).toBe(403);
    expect((await put(category._id.toString(), { sortOrder: 9 }, reader)).status).toBe(403);
    expect((await CategoryModel.findById(category._id).lean())?.sortOrder).toBe(4);
  });
});

describe("hierarchy refusals reach the console as 409 with the message", () => {
  it("publishing under an unpublished parent, unpublishing a parent with a published child, and a fifth level", async () => {
    const parent = (await post({ published: false })).body;
    const published = await post({ parentId: parent._id, published: true });
    expect(published.status).toBe(409);
    expect(JSON.stringify(published.body)).toContain("needs a published parent");

    const live = (await post({ published: true })).body;
    await post({ parentId: live._id, published: true });
    const unpublish = await put(live._id, { published: false });
    expect(unpublish.status).toBe(409);
    expect(JSON.stringify(unpublish.body)).toContain("still published");

    let leaf = (await post({})).body;
    for (let level = 2; level <= 4; level += 1) leaf = (await post({ parentId: leaf._id })).body;
    const tooDeep = await post({ parentId: leaf._id });
    expect(tooDeep.status).toBe(409);
    expect(JSON.stringify(tooDeep.body)).toContain("at most 4 levels deep");
  });

  it("deleting a category that has sub-categories", async () => {
    const parent = (await post({})).body;
    await post({ parentId: parent._id });
    const refused = await del(parent._id);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("Move or remove those first");
    expect(await CategoryModel.countDocuments()).toBe(2);
  });
});

describe("PUT /api/admin/categories/reorder size bound", () => {
  const entries = (count: number) => Array.from({ length: count }, () => ({ categoryId: new mongoose.Types.ObjectId().toString(), sortOrder: 1 }));

  it("accepts 500 entries and refuses 501 with a 400 naming items", async () => {
    expect((await sort(entries(500))).status).toBe(204);
    const { status, body } = await sort(entries(501));
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain("items");
  });
});
