import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { StockMovementModel } from "src/server/catalog/stock-movement.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { InventorySettingsModel } from "src/server/fulfilment/inventory-settings.schema";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/*
 * Route level, through the real DTO validation, auth guard and serializer:
 *  - stock changes only through adjustments (a variant PUT carrying `stock` is refused);
 *  - the Adjustments log is permission-gated, with the negative case;
 *  - a new variant takes the store's default inventory policy;
 *  - unit of measure, weight and dimensions are validated and round-trip.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const listMovements = (await import("./movements/route")).GET as RouteHandler;
const adjust = (await import("./[id]/adjust/route")).PUT as RouteHandler;
const createVariant = (await import("../variants/route")).POST as RouteHandler;
const updateVariant = (await import("../variants/[id]/route")).PUT as RouteHandler;
const getVariant = (await import("../variants/[id]/route")).GET as RouteHandler;

let owner: AdminCaller;
let productId: string;

const send = async (caller: AdminCaller, handler: RouteHandler, path: string, method: string, body?: unknown, id?: string) => {
  const response = await caller.call(handler, path, { method, body, params: id ? { id } : {} });
  return { status: response.status, body: await response.json().catch(() => undefined) };
};

let skuSeq = 0;
const newVariant = (overrides: Record<string, unknown> = {}) => ({ productId, sku: `SKU-${(skuSeq += 1)}`, optionValues: [{ key: "size", value: `s${skuSeq}` }], price: "10.00", stock: 0, ...overrides });

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  await Promise.all([VariantModel.deleteMany({}), ProductModel.deleteMany({}), CategoryModel.deleteMany({}), StockMovementModel.deleteMany({}), InventorySettingsModel.deleteMany({}), removeHarnessStaff()]);
  owner = await signInAsOwner();
  const category = await CategoryModel.create({ slug: "cat" });
  const product = await ProductModel.create({ slug: "prod", categoryId: category._id, lifecycle: "published", name: { en: "Prod", ar: "منتج" }, optionAxes: [{ key: "size", name: { en: "Size", ar: "مقاس" } }] });
  productId = product._id.toString();
});
afterAll(async () => {
  await Promise.all([VariantModel.deleteMany({}), ProductModel.deleteMany({}), CategoryModel.deleteMany({}), StockMovementModel.deleteMany({}), InventorySettingsModel.deleteMany({}), removeHarnessStaff()]);
  await mongoose.disconnect();
});

describe("stock moves only through adjustments", () => {
  it("refuses a variant PUT that carries `stock`, and leaves the count alone", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ stock: 5 }));
    expect(created.status).toBe(201);

    const refused = await send(owner, updateVariant, `/api/admin/variants/${created.body._id}`, "PUT", { stock: 999 }, created.body._id);

    expect(refused.status).toBe(400);
    expect((await VariantModel.findById(created.body._id).lean())?.stock).toBe(5);
  });

  it("still accepts every other variant edit", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ stock: 5 }));
    const updated = await send(owner, updateVariant, `/api/admin/variants/${created.body._id}`, "PUT", { price: "12.50", lowStockThreshold: 2 }, created.body._id);
    expect(updated.status).toBe(200);
    expect((await VariantModel.findById(created.body._id).lean())?.stock).toBe(5);
  });

  it("records the opening stock of a new variant as a RECEIPT by the staff member who created it", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ stock: 6 }));

    const movement = await StockMovementModel.findOne({ variantId: created.body._id }).lean();
    expect(movement).toMatchObject({ delta: 6, reason: "RECEIPT", note: "Opening stock" });
    expect(movement?.actorId).toBeDefined();
  });

  it("records nothing for a variant created at zero", async () => {
    await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ stock: 0 }));
    expect(await StockMovementModel.countDocuments({})).toBe(0);
  });
});

describe("GET /api/admin/inventory/movements", () => {
  async function seedLog() {
    const a = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ stock: 10 }));
    const b = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ stock: 4 }));
    await send(owner, adjust, `/api/admin/inventory/${a.body._id}/adjust`, "PUT", { delta: -3, reason: "DAMAGE", note: "Dropped" }, a.body._id);
    return { a: a.body._id as string, b: b.body._id as string };
  }

  it("lists every movement with its variant, reason, signed delta and who made it, newest first", async () => {
    const { a } = await seedLog();

    const { status, body } = await send(owner, listMovements, "/api/admin/inventory/movements", "GET");

    expect(status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.data[0]).toMatchObject({ variantId: a, reason: "DAMAGE", delta: -3, note: "Dropped", productName: { en: "Prod" } });
    expect(body.data[0].actor).toMatchObject({ kind: "STAFF", name: "Owner" });
    expect(body.data[0].sku).toMatch(/^SKU-/);
  });

  it("filters by variant and by reason", async () => {
    const { a, b } = await seedLog();

    const one = await send(owner, listMovements, `/api/admin/inventory/movements?variantId=${b}`, "GET");
    expect(one.body.data.map((row: { variantId: string }) => row.variantId)).toEqual([b]);

    const damage = await send(owner, listMovements, "/api/admin/inventory/movements?reason=DAMAGE", "GET");
    expect(damage.body.data).toHaveLength(1);
    expect(damage.body.data[0].variantId).toBe(a);

    const byProduct = await send(owner, listMovements, `/api/admin/inventory/movements?productId=${productId}`, "GET");
    expect(byProduct.body.data).toHaveLength(3);
  });

  it("paginates", async () => {
    await seedLog();
    const page = await send(owner, listMovements, "/api/admin/inventory/movements?limit=2&page=1", "GET");
    expect(page.body.data).toHaveLength(2);
    expect(page.body.total ?? page.body.meta?.total ?? page.body.pagination?.total).toBe(3);
  });

  it("rejects a malformed variant id", async () => {
    expect((await send(owner, listMovements, "/api/admin/inventory/movements?variantId=nope", "GET")).status).toBe(400);
  });

  it("NEGATIVE: refuses staff without StockMovement.read, even with Variant.read and Inventory.adjust", async () => {
    await seedLog();
    const staff = await signInWithPermissions([AppPermission.VARIANT.READ, "Inventory.adjust"]);

    const { status, body } = await send(staff, listMovements, "/api/admin/inventory/movements", "GET");

    expect(status).toBe(403);
    expect(body?.data).toBeUndefined();
  });

  it("NEGATIVE: refuses staff with no permissions at all", async () => {
    const staff = await signInWithPermissions([]);
    expect((await send(staff, listMovements, "/api/admin/inventory/movements", "GET")).status).toBe(403);
  });

  it("allows staff holding exactly StockMovement.read", async () => {
    await seedLog();
    const staff = await signInWithPermissions([AppPermission.STOCK_MOVEMENT.READ]);
    expect((await send(staff, listMovements, "/api/admin/inventory/movements", "GET")).status).toBe(200);
  });
});

describe("a new variant takes the store's default inventory policy", () => {
  it("uses the default the merchant set when none is chosen", async () => {
    await InventorySettingsModel.create({ defaultInventoryPolicy: "CONTINUE_SELLING" });
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant());
    expect(created.body.backorderPolicy).toBe("CONTINUE_SELLING");
  });

  it("an explicit choice beats the default, both ways", async () => {
    await InventorySettingsModel.create({ defaultInventoryPolicy: "CONTINUE_SELLING" });
    const deny = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ backorderPolicy: "DENY" }));
    expect(deny.body.backorderPolicy).toBe("DENY");

    await InventorySettingsModel.updateMany({}, { defaultInventoryPolicy: "DENY" });
    const sell = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ backorderPolicy: "CONTINUE_SELLING" }));
    expect(sell.body.backorderPolicy).toBe("CONTINUE_SELLING");
  });

  it("falls back to DENY when the store has never saved inventory settings", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant());
    expect(created.body.backorderPolicy).toBe("DENY");
  });

  it("changing the default later does not rewrite variants that already exist", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant());
    await InventorySettingsModel.create({ defaultInventoryPolicy: "CONTINUE_SELLING" });
    expect((await VariantModel.findById(created.body._id).lean())?.backorderPolicy).toBe("DENY");
  });
});

describe("unit of measure", () => {
  it("accepts EACH, PACK and BOX, and stores them with unitsPerSale", async () => {
    for (const unitOfMeasure of ["EACH", "PACK", "BOX"]) {
      const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ unitOfMeasure, unitsPerSale: 6 }));
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ unitOfMeasure, unitsPerSale: 6 });
    }
  });

  it("defaults to EACH, one per sale", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant());
    expect(created.body).toMatchObject({ unitOfMeasure: "EACH", unitsPerSale: 1 });
  });

  it.each(["PALLET", "each", "", "KG"])("refuses %j as a unit of measure", async (unitOfMeasure) => {
    expect((await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ unitOfMeasure }))).status).toBe(400);
  });

  it.each([0, -2, 1.5, "many"])("refuses unitsPerSale %j: a whole number, at least 1", async (unitsPerSale) => {
    expect((await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ unitsPerSale }))).status).toBe(400);
  });

  it("applies the same rules on update", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant());
    const path = `/api/admin/variants/${created.body._id}`;

    expect((await send(owner, updateVariant, path, "PUT", { unitOfMeasure: "PALLET" }, created.body._id)).status).toBe(400);
    expect((await send(owner, updateVariant, path, "PUT", { unitsPerSale: 0 }, created.body._id)).status).toBe(400);
    expect((await send(owner, updateVariant, path, "PUT", { unitOfMeasure: "BOX", unitsPerSale: 12 }, created.body._id)).status).toBe(200);
    expect((await VariantModel.findById(created.body._id).lean())).toMatchObject({ unitOfMeasure: "BOX", unitsPerSale: 12 });
  });

  it("the schema itself refuses a value the DTO would have caught", async () => {
    await expect(VariantModel.create({ productId, sku: "BAD-UNIT", variantKey: "bad-unit", price: "1.00", unitOfMeasure: "PALLET" } as never)).rejects.toThrow(/unitOfMeasure/);
    await expect(VariantModel.create({ productId, sku: "BAD-UNITS", variantKey: "bad-units", price: "1.00", unitsPerSale: 2.5 } as never)).rejects.toThrow(/unitsPerSale/);
  });
});

describe("weight and dimensions (grams and millimetres)", () => {
  it("round-trips through create, update and read", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ weight: 250.5, length: 300, width: 200, height: 45.5 }));
    expect(created.body).toMatchObject({ weight: 250.5, length: 300, width: 200, height: 45.5 });

    const updated = await send(owner, updateVariant, `/api/admin/variants/${created.body._id}`, "PUT", { weight: 1200 }, created.body._id);
    expect(updated.body).toMatchObject({ weight: 1200, length: 300, width: 200, height: 45.5 });

    const read = await send(owner, getVariant, `/api/admin/variants/${created.body._id}`, "GET", undefined, created.body._id);
    expect(read.body).toMatchObject({ weight: 1200, length: 300, width: 200, height: 45.5 });
    expect(await VariantModel.collection.findOne({ _id: new mongoose.Types.ObjectId(created.body._id) })).toMatchObject({ weight: 1200, length: 300 });
  });

  it("are absent, not zero, when never recorded", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant());
    const raw = await VariantModel.collection.findOne({ _id: new mongoose.Types.ObjectId(created.body._id) });
    for (const field of ["weight", "length", "width", "height"]) expect(raw).not.toHaveProperty(field);
  });

  it("keeps zero as a real value", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ weight: 0 }));
    expect(created.body.weight).toBe(0);
  });

  it.each(["weight", "length", "width", "height"])("refuses a negative %s", async (field) => {
    expect((await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ [field]: -1 }))).status).toBe(400);
  });

  it.each(["weight", "length", "width", "height"])("refuses a non-numeric %s", async (field) => {
    expect((await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ [field]: "heavy" }))).status).toBe(400);
  });

  it("refuses a negative value on update too, leaving the stored one alone", async () => {
    const created = await send(owner, createVariant, "/api/admin/variants", "POST", newVariant({ weight: 100 }));
    const refused = await send(owner, updateVariant, `/api/admin/variants/${created.body._id}`, "PUT", { weight: -5 }, created.body._id);
    expect(refused.status).toBe(400);
    expect((await VariantModel.findById(created.body._id).lean())?.weight).toBe(100);
  });
});
