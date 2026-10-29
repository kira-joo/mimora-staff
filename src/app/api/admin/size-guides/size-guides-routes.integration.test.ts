import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { SizeGuideModel } from "src/server/catalog/size-guide.schema";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/** Size-guide writes through the real DTO pipeline and auth guard: chart validation, and delete refused while products use the guide. */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const collection = await import("./route");
const item = await import("./[id]/route");
const create = collection.POST as RouteHandler;
const update = item.PUT as RouteHandler;
const remove = item.DELETE as RouteHandler;

const PATH = "/api/admin/size-guides";
const LABEL = { ar: "دليل", en: "Guide" };
const CHART = { headers: ["Size", "Chest"], rows: [["S", "34-36"]] };

let owner: AdminCaller;
const wipe = () => Promise.all([SizeGuideModel.deleteMany({}), ProductModel.deleteMany({}), CategoryModel.deleteMany({})]);

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
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as any };
};
const post = (chartData: unknown, caller = owner) => caller.call(create, PATH, { method: "POST", body: { name: LABEL, description: LABEL, chartData } }).then(json);
const put = (id: string, body: unknown, caller = owner) => caller.call(update, `${PATH}/${id}`, { method: "PUT", params: { id }, body }).then(json);
const del = (id: string, caller = owner) => caller.call(remove, `${PATH}/${id}`, { method: "DELETE", params: { id } }).then(json);

describe("size guide chartData validation", () => {
  it("accepts a valid chart on create and on update", async () => {
    const created = await post(CHART);
    expect(created.status).toBe(201);
    const next = { headers: [{ ar: "المقاس", en: "Size" }, "Waist"], rows: [[{ ar: "وسط", en: "Medium" }, 30]] };
    expect((await put(created.body._id, { chartData: next })).status).toBe(200);
    expect((await SizeGuideModel.findById(created.body._id).lean())?.chartData).toEqual(next);
  });

  it.each([
    ["not an object", "chart"],
    ["a missing header row", { rows: [["S"]] }],
    ["no rows", { headers: ["Size"], rows: [] }],
    ["a ragged row", { headers: ["Size", "Chest"], rows: [["S"]] }],
    ["a blank size cell", { headers: ["Size", "Chest"], rows: [["", "34"]] }],
    ["an unexpected key", { ...CHART, extra: 1 }],
    ["an oversized chart", { headers: Array.from({ length: 13 }, (_, i) => `c${i}`), rows: [Array.from({ length: 13 }, () => "x")] }],
  ])("refuses %s on create with a 400 naming chartData, and stores nothing", async (_, chartData) => {
    const { status, body } = await post(chartData);
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toContain("chartData");
    expect(await SizeGuideModel.countDocuments({})).toBe(0);
  });

  it("refuses an invalid chart on update and leaves the stored one", async () => {
    const created = await post(CHART);
    const { status } = await put(created.body._id, { chartData: { headers: ["Size", "Chest"], rows: [["S"]] } });
    expect(status).toBe(400);
    expect((await SizeGuideModel.findById(created.body._id).lean())?.chartData).toEqual(CHART);
  });

  it("an update that does not touch chartData does not need one", async () => {
    const created = await post(CHART);
    expect((await put(created.body._id, { name: { ar: "جديد", en: "New" } })).status).toBe(200);
  });
});

describe("DELETE /api/admin/size-guides/[id]", () => {
  async function productUsing(sizeGuide: mongoose.Types.ObjectId, slug: string) {
    const category = (await CategoryModel.findOne({ slug: "c" })) ?? (await CategoryModel.create({ slug: "c" }));
    return ProductModel.create({ slug, categoryId: category._id, name: { ar: "م", en: "P" }, sizeGuide });
  }

  it("deletes an unused guide", async () => {
    const guide = await SizeGuideModel.create({ name: LABEL, description: LABEL, chartData: CHART });
    expect((await del(guide._id.toString())).status).toBe(204);
    expect(await SizeGuideModel.countDocuments({})).toBe(0);
  });

  it("refuses with a 409 carrying the product count while products use the guide, and deletes nothing", async () => {
    const guide = await SizeGuideModel.create({ name: LABEL, description: LABEL, chartData: CHART });
    await productUsing(guide._id, "p1");
    await productUsing(guide._id, "p2");
    await productUsing(new mongoose.Types.ObjectId(), "elsewhere"); // another guide's product is not counted

    const { status, body } = await del(guide._id.toString());
    expect(status).toBe(409);
    expect(JSON.stringify(body)).toContain("2 products");
    expect(JSON.stringify(body)).toContain('"productCount":2');
    expect(await SizeGuideModel.countDocuments({})).toBe(1);
  });

  it("the singular reads correctly", async () => {
    const guide = await SizeGuideModel.create({ name: LABEL, description: LABEL, chartData: CHART });
    await productUsing(guide._id, "p1");
    expect(JSON.stringify((await del(guide._id.toString())).body)).toContain("1 product.");
  });

  it("deletes once the last product is detached", async () => {
    const guide = await SizeGuideModel.create({ name: LABEL, description: LABEL, chartData: CHART });
    const product = await productUsing(guide._id, "p1");
    expect((await del(guide._id.toString())).status).toBe(409);
    await ProductModel.updateOne({ _id: product._id }, { $unset: { sizeGuide: 1 } });
    expect((await del(guide._id.toString())).status).toBe(204);
  });

  it("is 404 for a guide that does not exist", async () => {
    expect((await del(new mongoose.Types.ObjectId().toString())).status).toBe(404);
  });
});

describe("size guide permissions — the negative case", () => {
  it("cannot create, update or delete without the matching permission (403), and nothing changes", async () => {
    const guide = await SizeGuideModel.create({ name: LABEL, description: LABEL, chartData: CHART });
    const reader = await signInWithPermissions([AppPermission.SIZE_GUIDE.READ, AppPermission.SIZE_GUIDE.READ_ONE]);

    expect((await post(CHART, reader)).status).toBe(403);
    expect((await put(guide._id.toString(), { name: LABEL }, reader)).status).toBe(403);
    expect((await del(guide._id.toString(), reader)).status).toBe(403);
    expect(await SizeGuideModel.countDocuments({})).toBe(1);
  });

  it("a deleter can delete but the in-use refusal still applies to them", async () => {
    const guide = await SizeGuideModel.create({ name: LABEL, description: LABEL, chartData: CHART });
    const category = await CategoryModel.create({ slug: "c" });
    await ProductModel.create({ slug: "p", categoryId: category._id, name: { ar: "م", en: "P" }, sizeGuide: guide._id });
    const deleter = await signInWithPermissions([AppPermission.SIZE_GUIDE.DELETE]);
    expect((await del(guide._id.toString(), deleter)).status).toBe(409);
  });
});
