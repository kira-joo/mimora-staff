import mongoose from "mongoose";
import { Decimal } from "decimal.js";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { ActivityLogModel } from "src/server/core/activity-log.schema";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { InventorySettingsModel } from "src/server/fulfilment/inventory-settings.schema";
import { OrderModel } from "src/server/commerce/order.schema";
import { CustomerModel } from "src/server/identity/customer.schema";
import { listOrders } from "src/server/admin/orders/list-orders";
import { listInventory } from "src/server/admin/inventory/list-inventory";
import { listCustomers } from "src/server/admin/customers/list-customers";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type RouteHandler } from "../test-support/admin-route-harness";

vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const ordersExport = (await import("./orders/route")).GET as RouteHandler;
const customersExport = (await import("./customers/route")).GET as RouteHandler;
const inventoryExport = (await import("./inventory/route")).GET as RouteHandler;

/** A small RFC 4180 parser — the test's own, so an escaping bug in the exporter cannot hide behind the same bug in a parser. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"', (i += 1));
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") (row.push(cell), (cell = ""));
    else if (ch === "\r" && text[i + 1] === "\n") (row.push(cell), rows.push(row), (row = []), (cell = ""), (i += 1));
    else cell += ch;
  }
  return rows;
}

async function download(caller: Awaited<ReturnType<typeof signInAsOwner>>, handler: RouteHandler, path: string) {
  const response = await caller.call(handler, path);
  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, rows: parseCsv(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)) };
}

let seq = 0;
const newOrder = (overrides: Record<string, unknown> = {}) =>
  OrderModel.create({
    orderNumber: `ORD-${++seq}-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    guestName: "Guest",
    status: "PLACED",
    placedAt: new Date(Date.now() - seq * 1000),
    subtotal: new Decimal("10"),
    total: new Decimal("12.5"),
    discount: new Decimal("0"),
    tax: new Decimal("1.5"),
    fulfilment: { mode: "PICKUP", fee: toMoney("1") },
    payment: { method: "COD", status: "NOT_REQUIRED" },
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    ...overrides,
  });

async function newVariant(stock: number, lowStockThreshold?: number, name = { en: "Tee", ar: "تيشيرت" }) {
  const category = await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId()}` });
  const product = await ProductModel.create({ slug: `p-${new mongoose.Types.ObjectId()}`, categoryId: category._id, lifecycle: "published", name });
  return VariantModel.create({
    productId: product._id,
    sku: `SKU-${new mongoose.Types.ObjectId()}`,
    variantKey: `key-${new mongoose.Types.ObjectId()}`,
    price: toMoney("10.00"),
    stock,
    lowStockThreshold,
    optionValues: [{ key: "Size", value: "M" }],
  });
}

const wipe = () => Promise.all([OrderModel.deleteMany({}), CustomerModel.deleteMany({}), VariantModel.deleteMany({}), ProductModel.deleteMany({}), CategoryModel.deleteMany({}), InventorySettingsModel.deleteMany({}), ActivityLogModel.deleteMany({}), removeHarnessStaff()]);

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await mongoose.disconnect();
});

describe("CSV exports — permissions (the negative case)", () => {
  const cases: Array<[string, RouteHandler, string, string, string]> = [
    ["orders", ordersExport, "/api/admin/exports/orders", AppPermission.ORDER.READ, CustomPermission.ORDER_EXPORT],
    ["customers", customersExport, "/api/admin/exports/customers", AppPermission.CUSTOMER.READ, CustomPermission.CUSTOMER_EXPORT],
    ["inventory", inventoryExport, "/api/admin/exports/inventory", AppPermission.VARIANT.READ, CustomPermission.INVENTORY_EXPORT],
  ];

  it.each(cases)("%s: read alone is refused, export alone is refused, both are served", async (_name, handler, path, read, exportPermission) => {
    const readOnly = await signInWithPermissions([read]);
    expect((await readOnly.call(handler, path)).status).toBe(403);
    const exportOnly = await signInWithPermissions([exportPermission]);
    expect((await exportOnly.call(handler, path)).status).toBe(403);
    const everythingElse = await signInWithPermissions([AppPermission.PRODUCT.READ, AppPermission.ORDER.UPDATE, AppPermission.CUSTOMER.READ_ONE, CustomPermission.PAYMENT_VERIFY]);
    expect((await everythingElse.call(handler, path)).status).toBe(403);
    const both = await signInWithPermissions([read, exportPermission]);
    const ok = await both.call(handler, path);
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
  });

  it("an export holder does not get a file for a different resource", async () => {
    const ordersOnly = await signInWithPermissions([AppPermission.ORDER.READ, CustomPermission.ORDER_EXPORT]);
    expect((await ordersOnly.call(customersExport, "/api/admin/exports/customers")).status).toBe(403);
    expect((await ordersOnly.call(inventoryExport, "/api/admin/exports/inventory")).status).toBe(403);
  });

  it("invalid input is the factory's 400, not a file", async () => {
    const owner = await signInAsOwner();
    expect((await owner.call(ordersExport, "/api/admin/exports/orders?status=NOPE")).status).toBe(400);
  });
});

describe("CSV exports — the file", () => {
  it("is UTF-8 with a BOM, text/csv, an attachment, never cached", async () => {
    const owner = await signInAsOwner();
    const { response, bytes } = await download(owner, customersExport, "/api/admin/exports/customers");
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="customers-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("round-trips Arabic names, addresses and mixed Arabic + Latin exactly", async () => {
    await CustomerModel.create({ phone: "+201005550501", name: "منى أحمد", email: "mona@example.com", passwordHash: "x" });
    await CustomerModel.create({ phone: "+201005550502", name: 'سارة "Sara", Co', passwordHash: "x" });
    await OrderModel.create({
      orderNumber: "ORD-AR-1", idempotencyKey: "k-ar", guestName: "مشتري ضيف", status: "PLACED", placedAt: new Date(), subtotal: new Decimal("1"), total: new Decimal("1"),
      fulfilment: { mode: "DELIVERY", zone: "القاهرة الكبرى", fee: toMoney("0") }, payment: { method: "COD", status: "NOT_REQUIRED" }, timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    });
    const owner = await signInAsOwner();

    const customers = (await download(owner, customersExport, "/api/admin/exports/customers")).rows;
    const names = customers.slice(1).map((row) => row[1]);
    expect(names.sort()).toEqual(['سارة "Sara", Co', "منى أحمد"].sort());

    const orders = (await download(owner, ordersExport, "/api/admin/exports/orders")).rows;
    const [header, row] = orders as [string[], string[]];
    expect(row[header.indexOf("Guest name")]).toBe("مشتري ضيف");
    expect(row[header.indexOf("Zone")]).toBe("القاهرة الكبرى");
  });

  it("neutralises formula injection in customer-typed text, and keeps real numbers numeric", async () => {
    await CustomerModel.create({ phone: "+201005550503", name: "=HYPERLINK(\"http://evil\",\"x\")", email: "a@example.com", passwordHash: "x" });
    await CustomerModel.create({ phone: "+201005550504", name: "+cmd|' /C calc'!A0", passwordHash: "x" });
    await CustomerModel.create({ phone: "+201005550505", name: "@SUM(1)", passwordHash: "x" });
    await CustomerModel.create({ phone: "+201005550506", name: "-1+1", passwordHash: "x" });
    await CustomerModel.create({ phone: "+201005550507", name: "\t=1", passwordHash: "x" });
    await newOrder({ guestName: "=1+1", total: new Decimal("-5") });
    const owner = await signInAsOwner();

    const customers = (await download(owner, customersExport, "/api/admin/exports/customers")).rows.slice(1);
    for (const row of customers) expect(row[1]).toMatch(/^'/);
    expect(customers.map((row) => row[1]).sort()).toContain("'=HYPERLINK(\"http://evil\",\"x\")");

    const [header, row] = (await download(owner, ordersExport, "/api/admin/exports/orders")).rows as [string[], string[]];
    expect(row[header.indexOf("Guest name")]).toBe("'=1+1");
    expect(row[header.indexOf("Total")]).toBe("-5.00");
  });

  it("formats money at fixed decimals, always", async () => {
    await newOrder({ subtotal: new Decimal("10"), total: new Decimal("12.5"), tax: new Decimal("1.5"), discount: new Decimal("0") });
    const owner = await signInAsOwner();
    const [header, row] = (await download(owner, ordersExport, "/api/admin/exports/orders")).rows as [string[], string[]];
    const cell = (name: string) => row[header.indexOf(name)];
    expect([cell("Subtotal"), cell("Discount"), cell("Shipping"), cell("Tax"), cell("Total")]).toEqual(["10.00", "0.00", "1.00", "1.50", "12.50"]);
  });

  it("has no row cap: more than two pages of customers all arrive, each exactly once", async () => {
    const count = 1_203;
    await CustomerModel.insertMany(Array.from({ length: count }, (_, i) => ({ phone: `+2011${String(i).padStart(8, "0")}`, name: `Customer ${i}`, passwordHash: "x" })));
    const owner = await signInAsOwner();
    const rows = (await download(owner, customersExport, "/api/admin/exports/customers")).rows;
    expect(rows).toHaveLength(count + 1);
    expect(new Set(rows.slice(1).map((row) => row[0])).size).toBe(count);
    expect(new Set(rows.slice(1).map((row) => row[1])).size).toBe(count);
  }, 60_000);

  it("has no row cap for orders either, with item counts", async () => {
    const count = 1_101;
    await OrderModel.insertMany(Array.from({ length: count }, (_, i) => ({
      orderNumber: `BULK-${i}`, idempotencyKey: `bulk-${i}`, guestName: `G${i}`, status: "PLACED", placedAt: new Date(), subtotal: new Decimal("1"), total: new Decimal("1"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0") }, payment: { method: "COD", status: "NOT_REQUIRED" }, timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    })));
    const owner = await signInAsOwner();
    const rows = (await download(owner, ordersExport, "/api/admin/exports/orders")).rows;
    expect(rows).toHaveLength(count + 1);
    expect(new Set(rows.slice(1).map((row) => row[0])).size).toBe(count);
  }, 60_000);

  it("is audited without any row: who exported what, with which filters", async () => {
    await newOrder({ status: "CANCELLED" });
    const owner = await signInAsOwner();
    await download(owner, ordersExport, "/api/admin/exports/orders?status=CANCELLED&page=3&limit=10");
    const entries = await ActivityLogModel.find({ entityType: "Order", action: "export" }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.changes).toEqual({ status: "CANCELLED" });
    expect(JSON.stringify(entries)).not.toContain("Guest");
  });
});

describe("CSV exports — the list's own filters", () => {
  it("orders: a filtered export returns exactly what the filtered list returns", async () => {
    await newOrder({ status: "PLACED" });
    await newOrder({ status: "CANCELLED", payment: { method: "COD", status: "REFUNDED" } });
    await newOrder({ status: "CANCELLED", fulfilment: { mode: "DELIVERY", zone: "Giza", fee: toMoney("1") } });
    await newOrder({ status: "DELIVERED", placedAt: new Date("2020-01-01") });
    const owner = await signInAsOwner();

    const orderQueries: Record<string, string>[] = [{ status: "CANCELLED" }, { mode: "DELIVERY" }, { paymentStatus: "REFUNDED" }, { zone: "Giza" }, { placedFrom: "2024-01-01T00:00:00.000Z" }, { placedTo: "2021-01-01T00:00:00.000Z" }];
    for (const query of orderQueries) {
      const qs = new URLSearchParams(query).toString();
      const exported = (await download(owner, ordersExport, `/api/admin/exports/orders?${qs}`)).rows.slice(1).map((row) => row[0]).sort();
      const listed = (await listOrders({ page: 1, limit: 100, ...query } as never)).data.map((order) => order.orderNumber).sort();
      expect(listed.length, JSON.stringify(query)).toBeGreaterThan(0);
      expect(exported, JSON.stringify(query)).toEqual(listed);
    }
    expect((await download(owner, ordersExport, "/api/admin/exports/orders")).rows).toHaveLength(5);
  });

  it("customers: the search filter matches the list", async () => {
    await CustomerModel.create({ phone: "+201005550601", name: "Mona", passwordHash: "x" });
    await CustomerModel.create({ phone: "+201005550602", name: "Omar", email: "omar@example.com", passwordHash: "x" });
    const owner = await signInAsOwner();
    for (const search of ["Mona", "omar@", "0602", "nobody"]) {
      const exported = (await download(owner, customersExport, `/api/admin/exports/customers?search=${encodeURIComponent(search)}`)).rows.slice(1).map((row) => row[2]!.replace(/^'/, "")).sort(); // a `+…` phone is formula-prefixed like any text cell
      const listed = (await listCustomers({ page: 1, limit: 100, search } as never)).data.map((customer) => customer.phone).sort();
      expect(exported, search).toEqual(listed);
    }
  });

  it("inventory: lowStock / outOfStock / product filters match the list, and rows carry both product languages", async () => {
    const low = await newVariant(2, 5);
    await newVariant(50, 5);
    const out = await newVariant(0);
    const owner = await signInAsOwner();

    const inventoryQueries: Record<string, string>[] = [{ lowStock: "true" }, { outOfStock: "true" }, { productId: low.productId.toString() }, {}];
    for (const query of inventoryQueries) {
      const qs = new URLSearchParams(query).toString();
      const exported = (await download(owner, inventoryExport, `/api/admin/exports/inventory?${qs}`)).rows.slice(1).map((row) => row[0]).sort();
      const listed = (await listInventory({ page: 1, limit: 100, ...query, ...(query.lowStock ? { lowStock: true } : {}), ...(query.outOfStock ? { outOfStock: true } : {}) } as never)).data.map((item) => item.sku).sort();
      expect(exported, JSON.stringify(query)).toEqual(listed);
    }
    const all = (await download(owner, inventoryExport, "/api/admin/exports/inventory")).rows;
    expect(all).toHaveLength(4);
    const row = all.find((r) => r[0] === out.sku)!;
    expect(row.slice(1, 5)).toEqual(["Tee", "تيشيرت", "Size: M", "0"]);
  });
});
