import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toMoney } from "@kira-joo/toolkit-common";
import { connectToDatabase } from "src/server/core/db/connect";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Option-axis value labels end to end: set through the admin product routes,
 * stored as sent, editable while variants exist (keys are not), and served by
 * the storefront detail and listing exactly as stored.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const createRoute = (await import("./route")).POST as RouteHandler;
const updateRoute = ((await import("./[id]/route")) as unknown as Record<"PUT", RouteHandler>).PUT;
const detailRoute = (await import("../../storefront/products/[slug]/route")).GET as unknown as RouteHandler;
const listRoute = (await import("../../storefront/products/route")).GET as unknown as RouteHandler;

const L = (en: string, ar: string) => ({ en, ar });
const colourAxis = (values: unknown) => ({ key: "colour", name: L("Colour", "اللون"), values });
let admin: AdminCaller;
let categoryId: string;

beforeAll(async () => {
  await connectToDatabase();
  admin = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([removeHarnessStaff(), ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);
  categoryId = (await CategoryModel.create({ slug: "c", published: true }))._id.toString();
});

async function create(optionAxes: unknown, lifecycle = "published") {
  const response = await admin.call(createRoute, "/api/admin/products", {
    method: "POST",
    body: { name: L("Tee", "قميص"), description: L("d", "و"), slug: `tee-${new mongoose.Types.ObjectId()}`, categoryId, lifecycle, optionAxes },
  });
  return { status: response.status, body: await response.json() };
}
const update = async (id: string, body: unknown) => {
  const response = await admin.call(updateRoute, `/api/admin/products/${id}`, { method: "PUT", body, params: { id } });
  return { status: response.status, body: await response.json() };
};
const storefront = async (handler: RouteHandler, path: string, params: Record<string, string> = {}) => {
  const response = await handler(new NextRequest(`http://localhost${path}`), { params: Promise.resolve(params) });
  return { status: response.status, body: (await response.json()) as any };
};

describe("optionAxes[].values", () => {
  it("round-trips through create, the schema, and the storefront detail and listing as stored", async () => {
    const values = [{ key: "olive", label: L("Olive", "زيتي"), swatch: "#808000" }, { key: "sand", label: L("Sand", "رملي") }];
    const created = await create([colourAxis(values)]);
    expect(created.status).toBe(201);
    expect(created.body.optionAxes[0].values).toEqual(values);

    const stored = await ProductModel.collection.findOne({ _id: new mongoose.Types.ObjectId(created.body._id) });
    expect(stored?.optionAxes[0].values).toEqual(values);

    const detail = await storefront(detailRoute, `/api/storefront/products/${created.body.slug}`, { slug: created.body.slug });
    expect(detail.status).toBe(200);
    expect(detail.body.product.optionAxes[0].values).toEqual(values);

    const list = await storefront(listRoute, "/api/storefront/products");
    expect(list.body.data[0].optionAxes[0].values).toEqual(values);
  });

  it("an axis without values stays as it was — no empty array appears", async () => {
    const created = await create([{ key: "size", name: L("Size", "المقاس") }]);
    expect(created.status).toBe(201);
    expect(created.body.optionAxes[0]).not.toHaveProperty("values");
    const stored = await ProductModel.collection.findOne({ _id: new mongoose.Types.ObjectId(created.body._id) });
    expect(stored?.optionAxes[0]).not.toHaveProperty("values");
  });

  it("rejects a bad swatch and a missing label with a 400", async () => {
    expect((await create([colourAxis([{ key: "olive", label: L("Olive", "زيتي"), swatch: "olive" }])])).status).toBe(400);
    expect((await create([colourAxis([{ key: "olive" }])])).status).toBe(400);
  });

  it("labels and swatches stay editable once variants exist; the axis keys do not", async () => {
    const created = await create([colourAxis([{ key: "olive", label: L("Olive", "زيتي") }])], "draft");
    await VariantModel.create({ productId: created.body._id, sku: "T-1", variantKey: "olive", optionValues: [{ key: "colour", value: "olive" }], price: toMoney("10.00"), stock: 1 });

    const relabelled = await update(created.body._id, { optionAxes: [colourAxis([{ key: "olive", label: L("Olive green", "أخضر زيتي"), swatch: "#556B2F" }, { key: "sand", label: L("Sand", "رملي") }])] });
    expect(relabelled.status).toBe(200);
    expect(relabelled.body.optionAxes[0].values).toHaveLength(2);
    expect(relabelled.body.optionAxes[0].values[0]).toMatchObject({ label: L("Olive green", "أخضر زيتي"), swatch: "#556B2F" });

    const keyChange = await update(created.body._id, { optionAxes: [{ key: "colour-renamed", name: L("Colour", "اللون") }] });
    expect(keyChange.status).toBe(409);
  });
});
