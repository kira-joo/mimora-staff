import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "../../../test-support/admin-route-harness";

/** Route-level D-11: publishing without the default locale is a 400 mapped to the field the form must fix. */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../../../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const putLifecycle = (await import("./route")).PUT as RouteHandler;
let admin: AdminCaller;

async function draft(name: { ar: string; en: string }) {
  const category = await CategoryModel.create({ name: { ar: "فئة", en: "Category" }, slug: `c-${Date.now()}-${Math.random()}`, published: true, sortOrder: 0 });
  return ProductModel.create({ name, description: { ar: "", en: "" }, slug: `p-${Date.now()}-${Math.random()}`, categoryId: category._id, lifecycle: "draft" });
}

beforeAll(async () => {
  await connectToDatabase();
  admin = await signInAsOwner();
});

afterAll(async () => {
  await Promise.all([removeHarnessStaff(), ProductModel.deleteMany({}), CategoryModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([ProductModel.deleteMany({}), CategoryModel.deleteMany({})]);
});

describe("PUT /api/admin/products/[id]/lifecycle", () => {
  it("refuses to publish an English-only product with a 400 on `name`", async () => {
    const product = await draft({ ar: "", en: "Shirt" });
    const response = await admin.call(putLifecycle, `/api/admin/products/${product._id}/lifecycle`, { method: "PUT", body: { lifecycle: "published" }, params: { id: product._id.toString() } });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/"field":"name".*default language/);
    expect((await ProductModel.findById(product._id).lean())?.lifecycle).toBe("draft");
  });

  it("publishes once the Arabic name is there", async () => {
    const product = await draft({ ar: "قميص", en: "" });
    const response = await admin.call(putLifecycle, `/api/admin/products/${product._id}/lifecycle`, { method: "PUT", body: { lifecycle: "published" }, params: { id: product._id.toString() } });
    expect(response.status).toBe(200);
  });
});
