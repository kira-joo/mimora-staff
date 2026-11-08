import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { sanitizeLeanResult } from "@kira-joo/backend-toolkit-mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { StockMovementModel } from "src/server/catalog/stock-movement.schema";
import { InventorySettingsModel } from "src/server/fulfilment/inventory-settings.schema";
import { stockMovementRepository, variantRepository } from "src/server/core/repositories";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../../test-support/admin-route-harness";

/**
 * The variant matrix grid's bulk routes, as Next calls them. Creating the chosen combinations and editing prices
 * inline are each ONE transaction: all rows or none, with the rollback proven against writes that really happened.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { POST, PUT } = (await import("./route")) as unknown as { POST: RouteHandler; PUT: RouteHandler };

let owner: AdminCaller;
let productId: string;
let otherProductId: string;

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});
/** Lets the real write land, THEN fails the nth call — so the rollback has a write that genuinely happened to undo. */
function failAfterWrite(repo: object, method: string, nth: number) {
  const target = repo as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method]!.bind(repo);
  let calls = 0;
  spies.push(
    vi.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
      const result = await original(...args);
      calls += 1;
      if (calls === nth) throw new Error("injected failure");
      return result;
    })
  );
}

/** Raw lean reads return BSON Decimal128; the toolkit revives it to Decimal, which is what the app reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sanitizeLeanResult revives BSON Decimal128 into Decimal, so the lean document's real type differs from the schema type; these tests read it as loosely-typed data.
const lean = <T>(value: T) => sanitizeLeanResult(value) as T extends null ? null : any;

const combo = (colour: string, size: string) => [{ key: "colour", value: colour }, { key: "size", value: size }];
const row = (sku: string, colour: string, size: string, extra: Record<string, unknown> = {}) => ({ sku, optionValues: combo(colour, size), price: "100.00", stock: 5, ...extra });
const post = (rows: unknown[], caller = owner, id = productId) => caller.call(POST, "/api/admin/variants/bulk", { method: "POST", body: { productId: id, rows } });
const put = (rows: unknown[], caller = owner, id = productId) => caller.call(PUT, "/api/admin/variants/bulk", { method: "PUT", body: { productId: id, rows } });
const skus = async () => (await VariantModel.find({}).lean()).map((v) => v.sku).sort();

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([removeHarnessStaff(), ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({}), StockMovementModel.deleteMany({}), InventorySettingsModel.deleteMany({})]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({}), StockMovementModel.deleteMany({}), InventorySettingsModel.deleteMany({})]);
  const category = await CategoryModel.create({ slug: "c", published: true });
  const axes = [
    { key: "colour", name: { ar: "اللون", en: "Colour" } },
    { key: "size", name: { ar: "المقاس", en: "Size" } },
  ];
  const make = async (slug: string) => (await ProductModel.create({ name: { ar: "منتج", en: "Product" }, description: { ar: "", en: "" }, slug, categoryId: category._id, optionAxes: axes, lifecycle: "published" }))._id.toString();
  productId = await make("p");
  otherProductId = await make("other");
});

describe("POST /api/admin/variants/bulk — create the chosen combinations", () => {
  it("creates a sparse selection (3 of 4 combinations), each with opening stock recorded as a RECEIPT", async () => {
    const response = await post([row("R-S", "red", "s", { stock: 4 }), row("R-M", "red", "m", { compareAtPrice: "120.00", costPrice: "60.00" }), row("B-M", "blue", "m", { stock: 0 })]);
    expect(response.status).toBe(201);
    expect(await skus()).toEqual(["B-M", "R-M", "R-S"]);

    const rm = lean(await VariantModel.findOne({ sku: "R-M" }).lean());
    expect(rm?.variantKey).toBe(`${productId}|colour=red|size=m`);
    expect(rm?.compareAtPrice?.toFixed(2)).toBe("120.00");
    expect(rm?.costPrice?.toFixed(2)).toBe("60.00");
    expect(rm?.backorderPolicy).toBe("DENY");

    const movements = await StockMovementModel.find({}).lean();
    expect(movements.map((m) => [m.reason, m.delta, m.note]).sort()).toEqual([["RECEIPT", 4, "Opening stock"], ["RECEIPT", 5, "Opening stock"]].sort());
    const product = lean(await ProductModel.findById(productId).lean());
    expect(product?.listing.purchasableVariantCount).toBe(2);
    expect(product?.listing.minActivePrice?.toFixed(2)).toBe("100.00");
  });

  it("applies the store's default backorder policy, as a single create does", async () => {
    await InventorySettingsModel.create({ defaultInventoryPolicy: "CONTINUE_SELLING" });
    await post([row("R-S", "red", "s")]);
    expect((lean(await VariantModel.findOne({ sku: "R-S" }).lean()))?.backorderPolicy).toBe("CONTINUE_SELLING");
  });

  it("reports every problem at once, per row and field, and writes nothing", async () => {
    await VariantModel.create({ productId, sku: "TAKEN", variantKey: `${productId}|colour=red|size=s`, optionValues: combo("red", "s"), price: toMoney("1.00"), stock: 0 });
    const response = await post([row("TAKEN", "blue", "s"), row("NEW", "red", "s"), row("DUP", "blue", "m"), row("DUP", "blue", "l"), { sku: "BAD", optionValues: [{ key: "colour", value: "red" }], price: "1.00", stock: 1 }]);
    expect(response.status).toBe(400);
    const fields = ((await response.json()) as { validationErrors: Array<{ field: string }> }).validationErrors.map((e) => e.field).sort();
    expect(fields).toEqual(["rows.0.sku", "rows.1.optionValues", "rows.3.sku", "rows.4.optionValues"]);
    expect(await skus()).toEqual(["TAKEN"]);
    expect(await StockMovementModel.countDocuments()).toBe(0);
  });

  it.each([
    ["a malformed price", { price: "10,5" }],
    ["a negative price", { price: "-1" }],
    ["fractional stock", { stock: 1.5 }],
    ["negative stock", { stock: -1 }],
  ])("refuses %s with 400", async (_label, patch) => {
    expect((await post([{ ...row("A", "red", "s"), ...patch }])).status).toBe(400);
    expect(await skus()).toEqual([]);
  });

  it("refuses an empty batch, an oversize batch and an unknown product", async () => {
    expect((await post([])).status).toBe(400);
    expect((await post(Array.from({ length: 101 }, (_, i) => row(`S${i}`, `c${i}`, "m")))).status).toBe(400);
    expect((await post([row("A", "red", "s")], owner, new mongoose.Types.ObjectId().toString())).status).toBe(404);
  });

  it("ROLLBACK: a failure on the last row undoes every earlier variant, movement and the rollup", async () => {
    // The 3rd movement is written, then the transaction fails: rows 1-2 and the 3rd row's own write must all vanish.
    failAfterWrite(stockMovementRepository, "save", 3);
    const response = await post([row("A", "red", "s"), row("B", "red", "m"), row("C", "blue", "m")]);
    expect(response.status).toBe(500);

    expect(await skus()).toEqual([]);
    expect(await StockMovementModel.countDocuments()).toBe(0);
    expect((lean(await ProductModel.findById(productId).lean()))?.listing.purchasableVariantCount).toBe(0);
  });

  it("ROLLBACK: a failure while writing a variant leaves earlier rows' movements un-persisted too", async () => {
    failAfterWrite(variantRepository, "save", 2);
    expect((await post([row("A", "red", "s"), row("B", "red", "m")])).status).toBe(500);
    expect(await skus()).toEqual([]);
    expect(await StockMovementModel.countDocuments()).toBe(0);
  });
});

describe("PUT /api/admin/variants/bulk — inline edits", () => {
  let a: string;
  let b: string;
  beforeEach(async () => {
    await post([row("A", "red", "s", { compareAtPrice: "150.00", costPrice: "40.00" }), row("B", "red", "m")]);
    a = (lean(await VariantModel.findOne({ sku: "A" }).lean()))!._id.toString();
    b = (lean(await VariantModel.findOne({ sku: "B" }).lean()))!._id.toString();
  });

  it("changes price, compare-at, cost and on/off sale, clears with null, and recomputes the listing once", async () => {
    const response = await put([
      { id: a, price: "80.50", compareAtPrice: null, costPrice: "45.25" },
      { id: b, discontinued: true },
    ]);
    expect(response.status).toBe(200);
    const va = lean(await VariantModel.findById(a).lean());
    expect(va?.price.toFixed(2)).toBe("80.50");
    expect(va?.costPrice?.toFixed(2)).toBe("45.25");
    expect(va?.compareAtPrice).toBeUndefined();
    expect((lean(await VariantModel.findById(b).lean()))?.discontinued).toBe(true);
    const listing = (lean(await ProductModel.findById(productId).lean()))?.listing;
    expect(listing?.minActivePrice?.toFixed(2)).toBe("80.50");
    expect(listing?.purchasableVariantCount).toBe(1);
  });

  it("never touches stock: it is not a field of this route", async () => {
    expect((await put([{ id: a, stock: 999 }])).status).toBe(400);
    expect((lean(await VariantModel.findById(a).lean()))?.stock).toBe(5);
  });

  it("refuses a variant of another product, a repeated variant and a malformed amount — and changes nothing", async () => {
    const stranger = await VariantModel.create({ productId: otherProductId, sku: "X", variantKey: `${otherProductId}|colour=red|size=s`, optionValues: combo("red", "s"), price: toMoney("9.00"), stock: 1 });
    const response = await put([{ id: a, price: "1.00" }, { id: stranger._id.toString(), price: "2.00" }, { id: a, price: "3.00" }]);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { validationErrors: Array<{ field: string }> }).validationErrors.map((e) => e.field).sort()).toEqual(["rows.1.id", "rows.2.id"]);
    expect((lean(await VariantModel.findById(a).lean()))?.price.toFixed(2)).toBe("100.00");
    expect((lean(await VariantModel.findById(stranger._id).lean()))?.price.toFixed(2)).toBe("9.00");
    expect((await put([{ id: a, price: "abc" }])).status).toBe(400);
  });

  it("ROLLBACK: a failure on the second row undoes the first", async () => {
    failAfterWrite(variantRepository, "updateAtomic", 2);
    expect((await put([{ id: a, price: "1.00" }, { id: b, price: "2.00" }])).status).toBe(500);
    expect((lean(await VariantModel.findById(a).lean()))?.price.toFixed(2)).toBe("100.00");
    expect((lean(await VariantModel.findById(b).lean()))?.price.toFixed(2)).toBe("100.00");
    expect((lean(await ProductModel.findById(productId).lean()))?.listing.minActivePrice?.toFixed(2)).toBe("100.00");
  });
});

describe("permissions — the negative cases", () => {
  it.each([
    ["Variant.read only", [AppPermission.VARIANT.READ, AppPermission.VARIANT.READ_ONE]],
    ["Variant.update (cannot create)", [AppPermission.VARIANT.UPDATE]],
    ["Product.create (a different entity)", [AppPermission.PRODUCT.CREATE, AppPermission.PRODUCT.UPDATE]],
  ])("%s may not bulk-create: 403 and nothing written", async (_label, keys) => {
    const staff = await signInWithPermissions(keys);
    expect((await post([row("A", "red", "s")], staff)).status).toBe(403);
    expect(await skus()).toEqual([]);
    expect(await StockMovementModel.countDocuments()).toBe(0);
  });

  it.each([
    ["Variant.read only", [AppPermission.VARIANT.READ]],
    ["Variant.create (cannot update)", [AppPermission.VARIANT.CREATE]],
  ])("%s may not bulk-update: 403 and the price is untouched", async (_label, keys) => {
    await post([row("A", "red", "s")]);
    const id = (lean(await VariantModel.findOne({ sku: "A" }).lean()))!._id.toString();
    const staff = await signInWithPermissions(keys);
    expect((await put([{ id, price: "1.00" }], staff)).status).toBe(403);
    expect((lean(await VariantModel.findById(id).lean()))?.price.toFixed(2)).toBe("100.00");
  });

  it("Variant.create alone can bulk-create, and Variant.update alone can bulk-update", async () => {
    const creator = await signInWithPermissions([AppPermission.VARIANT.CREATE]);
    expect((await post([row("A", "red", "s")], creator)).status).toBe(201);
    const id = (lean(await VariantModel.findOne({ sku: "A" }).lean()))!._id.toString();
    const editor = await signInWithPermissions([AppPermission.VARIANT.UPDATE]);
    expect((await put([{ id, price: "7.00" }], editor)).status).toBe(200);
  });
});
