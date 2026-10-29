import mongoose from "mongoose";
import { Decimal } from "decimal.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { OrderLineModel, OrderModel } from "src/server/commerce/order.schema";
import { CustomerModel } from "src/server/identity/customer.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Carrier + tracking (#62), the lifecycle's two new states (#54), the board and list search, and the three printable
 * documents (#60, #61) — through the real admin routes: real DTO validation, real permission checks.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const putStatus = (await import("./[id]/status/route")).PUT as RouteHandler;
const putTracking = (await import("./[id]/tracking/route")).PUT as RouteHandler;
const getInvoice = (await import("./[id]/invoice/route")).GET as RouteHandler;
const getSlip = (await import("./[id]/packing-slip/route")).GET as RouteHandler;
const getPicking = (await import("./picking-list/route")).GET as RouteHandler;
const getBoard = (await import("./board/route")).GET as RouteHandler;
const getList = (await import("./route")).GET as RouteHandler;
const getDetail = (await import("./[id]/route")).GET as RouteHandler;
const putSettings = (await import("../fulfilment-settings/route")).PUT as RouteHandler;

const CARRIERS = [
  { key: "aramex", name: "Aramex", urlTemplate: "https://aramex.example/track?n={tracking}" },
  { key: "bosta", name: "Bosta", urlTemplate: "https://bosta.example/t/{tracking}" },
];

const clean = () => Promise.all([OrderModel.deleteMany({}), OrderLineModel.deleteMany({}), CustomerModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({}), removeHarnessStaff()]);
beforeAll(connectToDatabase);
afterAll(async () => {
  await clean();
  await mongoose.disconnect();
});
beforeEach(async () => {
  await clean();
  await FulfilmentSettingsModel.create({ carriers: CARRIERS });
});

async function seed(overrides: Record<string, unknown> = {}, lines: Array<[string, number]> = [["SKU-1", 2]]) {
  const doc = await OrderModel.create({
    orderNumber: `ORD-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestName: "Mona Adel",
    guestPhone: "+201000000001",
    status: "PROCESSING",
    placedAt: new Date(),
    subtotal: new Decimal("100"),
    total: new Decimal("100"),
    fulfilment: { mode: "DELIVERY", fee: new Decimal("0"), zone: "Cairo", addressSnapshot: { recipientName: "Sara Hany", phone: "+201000000002", addressLine1: "1 Nile", city: "Cairo", governorate: "Cairo" } },
    payment: { method: "COD", status: "NOT_REQUIRED" },
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    invoiceNumber: `INV-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`,
    invoiceSnapshot: { issuedAt: new Date(), tax: { mode: "ADDED", rate: 0 } },
    notes: "Ring twice",
    ...overrides,
  });
  let n = 0;
  for (const [sku, quantity] of lines) {
    await OrderLineModel.create({ orderId: doc._id, lineNumber: ++n, variantId: new mongoose.Types.ObjectId(), sku, productName: `Product ${sku}`, variantDescription: "M", quantity, unitPrice: new Decimal("50"), lineTotal: new Decimal(String(50 * quantity)) });
  }
  return doc;
}

const status = (caller: AdminCaller, doc: { _id: mongoose.Types.ObjectId }, body: Record<string, unknown>) =>
  caller.call(putStatus, `/api/admin/orders/${doc._id}/status`, { method: "PUT", body, params: { id: doc._id.toString() } });
const tracking = (caller: AdminCaller, doc: { _id: mongoose.Types.ObjectId }, body: Record<string, unknown>) =>
  caller.call(putTracking, `/api/admin/orders/${doc._id}/tracking`, { method: "PUT", body, params: { id: doc._id.toString() } });
const reload = (doc: { _id: mongoose.Types.ObjectId }) => OrderModel.findById(doc._id).lean();

describe("shipping with tracking", () => {
  it("snapshots the carrier name and the resolved link when marked shipped with a carrier and number", async () => {
    const owner = await signInAsOwner();
    const doc = await seed();
    const response = await status(owner, doc, { status: "SHIPPED", carrierKey: "aramex", trackingNumber: " AB123 " });
    expect(response.status).toBe(200);

    const stored = await reload(doc);
    expect(stored?.status).toBe("SHIPPED");
    expect(stored?.tracking).toMatchObject({ carrierKey: "aramex", carrierName: "Aramex", trackingNumber: "AB123", url: "https://aramex.example/track?n=AB123" });
    const shipped = stored?.timeline.find((entry) => entry.type === "ORDER_SHIPPED");
    expect(shipped?.metadata).toMatchObject({ carrierName: "Aramex", trackingNumber: "AB123" });
  });

  it("a later change to the carrier in settings does not move the order's link", async () => {
    const owner = await signInAsOwner();
    const doc = await seed();
    await status(owner, doc, { status: "SHIPPED", carrierKey: "aramex", trackingNumber: "AB123" });
    await FulfilmentSettingsModel.updateMany({}, { $set: { carriers: [{ key: "aramex", name: "Aramex Express", urlTemplate: "https://new.example/{tracking}" }] } });
    expect((await reload(doc))?.tracking).toMatchObject({ carrierName: "Aramex", url: "https://aramex.example/track?n=AB123" });
  });

  it("tracking is optional: shipping with neither field works and stores none", async () => {
    const owner = await signInAsOwner();
    const doc = await seed();
    expect((await status(owner, doc, { status: "SHIPPED" })).status).toBe(200);
    expect((await reload(doc))?.tracking).toBeUndefined();
  });

  it.each([
    ["a number without a carrier", { trackingNumber: "AB123" }, "carrierKey"],
    ["a carrier without a number", { carrierKey: "aramex" }, "trackingNumber"],
    ["an unconfigured carrier", { carrierKey: "dhl", trackingNumber: "AB123" }, "carrierKey"],
    ["a malformed number", { carrierKey: "aramex", trackingNumber: "a<b>" }, "trackingNumber"],
  ])("refuses %s, names the field, and does NOT ship the order", async (_label, extra, field) => {
    const owner = await signInAsOwner();
    const doc = await seed();
    const response = await status(owner, doc, { status: "SHIPPED", ...extra });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(field);
    expect((await reload(doc))?.status).toBe("PROCESSING");
  });

  it("refuses tracking on any other transition rather than dropping it silently", async () => {
    const owner = await signInAsOwner();
    const doc = await seed({ status: "SHIPPED" });
    const response = await status(owner, doc, { status: "IN_TRANSIT", carrierKey: "aramex", trackingNumber: "AB123" });
    expect(response.status).toBe(400);
    expect((await reload(doc))?.status).toBe("SHIPPED");
  });
});

describe("editing tracking later, with an audit trail", () => {
  it("adds tracking to a shipped order, then corrects it: both are on the timeline with the staff member and the before/after", async () => {
    const owner = await signInAsOwner();
    const doc = await seed({ status: "SHIPPED" });

    expect((await tracking(owner, doc, { carrierKey: "aramex", trackingNumber: "WRONG1" })).status).toBe(200);
    expect((await tracking(owner, doc, { carrierKey: "bosta", trackingNumber: "RIGHT2" })).status).toBe(200);

    const stored = await reload(doc);
    expect(stored?.tracking).toMatchObject({ carrierName: "Bosta", trackingNumber: "RIGHT2", url: "https://bosta.example/t/RIGHT2" });
    const edits = stored!.timeline.filter((entry) => entry.type === "ORDER_TRACKING_UPDATED");
    expect(edits).toHaveLength(2);
    expect(edits[1]).toMatchObject({ actorType: "STAFF", metadata: { previous: { trackingNumber: "WRONG1" }, current: { trackingNumber: "RIGHT2", carrierName: "Bosta" } } });
    expect(edits[1]!.actorId).toBeDefined();

    const detail = await (await owner.call(getDetail, "/x", { params: { id: doc._id.toString() } })).json();
    expect(detail.tracking).toMatchObject({ carrierName: "Bosta", trackingNumber: "RIGHT2", updatedByName: "Owner" });
  });

  it("requires both fields", async () => {
    const owner = await signInAsOwner();
    const doc = await seed({ status: "SHIPPED" });
    expect((await tracking(owner, doc, { carrierKey: "aramex", trackingNumber: "" })).status).toBe(400);
  });

  it.each(["PLACED", "PROCESSING", "CANCELLED"])("is refused (409) on an order that is %s — nothing has shipped", async (orderStatus) => {
    const owner = await signInAsOwner();
    const doc = await seed({ status: orderStatus });
    expect((await tracking(owner, doc, { carrierKey: "aramex", trackingNumber: "AB123" })).status).toBe(409);
  });

  it("is refused on a pickup order", async () => {
    const owner = await signInAsOwner();
    const doc = await seed({ status: "DELIVERED", fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "S", address: "a", phone: "1" } } });
    expect((await tracking(owner, doc, { carrierKey: "aramex", trackingNumber: "AB123" })).status).toBe(409);
  });

  it("NEGATIVE: needs Order.transition — read access alone is 403 and changes nothing", async () => {
    const reader = await signInWithPermissions([AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE]);
    const doc = await seed({ status: "SHIPPED" });
    expect((await tracking(reader, doc, { carrierKey: "aramex", trackingNumber: "AB123" })).status).toBe(403);
    expect((await reload(doc))?.tracking).toBeUndefined();
  });
});

describe("IN_TRANSIT and COLLECTED over the route", () => {
  it("moves a shipped delivery order to IN_TRANSIT and then DELIVERED, with timeline events", async () => {
    const owner = await signInAsOwner();
    const doc = await seed({ status: "SHIPPED" });
    expect((await status(owner, doc, { status: "IN_TRANSIT" })).status).toBe(200);
    expect((await status(owner, doc, { status: "DELIVERED" })).status).toBe(200);
    expect((await reload(doc))?.timeline.map((entry) => entry.type)).toEqual(["ORDER_PLACED", "ORDER_IN_TRANSIT", "ORDER_DELIVERED"]);
  });

  it("collects a ready pickup order — and refuses DELIVERED for it", async () => {
    const owner = await signInAsOwner();
    const pickup = { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "S", address: "a", phone: "1" } };
    const doc = await seed({ status: "READY_FOR_PICKUP", fulfilment: pickup });
    expect((await status(owner, doc, { status: "DELIVERED" })).status).toBe(409);
    expect((await status(owner, doc, { status: "COLLECTED" })).status).toBe(200);
    expect((await reload(doc))?.timeline.at(-1)?.type).toBe("ORDER_COLLECTED");
  });

  it("refuses IN_TRANSIT from PROCESSING and COLLECTED for a delivery order", async () => {
    const owner = await signInAsOwner();
    expect((await status(owner, await seed(), { status: "IN_TRANSIT" })).status).toBe(409);
    expect((await status(owner, await seed({ status: "SHIPPED" }), { status: "COLLECTED" })).status).toBe(409);
  });
});

describe("carriers in fulfilment settings", () => {
  const put = (caller: AdminCaller, carriers: unknown) => caller.call(putSettings, "/api/admin/fulfilment-settings", { method: "PUT", body: { carriers } });

  it("saves a valid list, replacing the old one", async () => {
    const owner = await signInAsOwner();
    expect((await put(owner, [{ key: "dhl", name: "DHL", urlTemplate: "https://dhl.example/{tracking}" }])).status).toBe(200);
    expect((await FulfilmentSettingsModel.findOne().lean())?.carriers.map((carrier) => carrier.key)).toEqual(["dhl"]);
  });

  it.each([
    ["http", [{ key: "x", name: "X", urlTemplate: "http://x.example/{tracking}" }]],
    ["no placeholder", [{ key: "x", name: "X", urlTemplate: "https://x.example/track" }]],
    ["javascript:", [{ key: "x", name: "X", urlTemplate: "javascript:alert({tracking})" }]],
    ["duplicate keys", [{ key: "x", name: "X", urlTemplate: "https://x.example/{tracking}" }, { key: "x", name: "Y", urlTemplate: "https://y.example/{tracking}" }]],
    ["a bad key", [{ key: "Bad Key", name: "X", urlTemplate: "https://x.example/{tracking}" }]],
  ])("refuses %s and leaves the saved list alone", async (_label, carriers) => {
    const owner = await signInAsOwner();
    expect((await put(owner, carriers)).status).toBe(400);
    expect((await FulfilmentSettingsModel.findOne().lean())?.carriers).toHaveLength(2);
  });

  it("[] removes every carrier", async () => {
    const owner = await signInAsOwner();
    expect((await put(owner, [])).status).toBe(200);
    expect((await FulfilmentSettingsModel.findOne().lean())?.carriers).toEqual([]);
  });
});

describe("list search and the board", () => {
  const list = async (caller: AdminCaller, query: string) => (await (await caller.call(getList, `/api/admin/orders?${query}`)).json()) as { data: Array<{ orderNumber: string; customerName?: string }>; total: number };

  it("finds an order by order number, guest name, guest phone and delivery recipient — server-side, case-insensitively", async () => {
    const owner = await signInAsOwner();
    const a = await seed({ orderNumber: "ORD-000101", guestName: "Mona Adel", guestPhone: "+201000000001" });
    const b = await seed({ orderNumber: "ORD-000102", guestName: "Omar Khaled", guestPhone: "+201555000777" });
    for (const [search, expected] of [["000101", a], ["mona", a], ["201555", b], ["OMAR", b], ["Sara Hany", a]] as const) {
      const result = await list(owner, `search=${encodeURIComponent(search)}`);
      expect(result.data.map((row) => row.orderNumber), search).toContain(expected.orderNumber);
    }
    expect((await list(owner, "search=mona")).data.map((row) => row.orderNumber)).not.toContain("ORD-000102");
  });

  it("finds a signed-in customer's order by the ACCOUNT's name or phone, and shows that name", async () => {
    const owner = await signInAsOwner();
    const customer = await CustomerModel.create({ phone: "+201222333444", passwordHash: "x", name: "Hala Mostafa", tokenVersion: 1 });
    await seed({ orderNumber: "ORD-000201", customerId: customer._id, guestName: undefined, guestPhone: undefined, fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "S", address: "a", phone: "1" } } });
    await seed({ orderNumber: "ORD-000202" });
    for (const search of ["Hala", "222333"]) {
      const result = await list(owner, `search=${search}`);
      expect(result.data.map((row) => row.orderNumber), search).toEqual(["ORD-000201"]);
      expect(result.data[0]!.customerName).toBe("Hala Mostafa");
    }
  });

  it("treats regex characters as text, and one character as no search at all", async () => {
    const owner = await signInAsOwner();
    await seed();
    await seed();
    expect((await list(owner, `search=${encodeURIComponent(".*")}`)).total).toBe(0);
    expect((await list(owner, "search=a")).total).toBe(2);
  });

  it("the board returns a column per working status, oldest first, with totals, honouring mode and search", async () => {
    const owner = await signInAsOwner();
    await seed({ orderNumber: "ORD-000301", status: "PLACED", placedAt: new Date("2026-03-02T00:00:00Z") });
    await seed({ orderNumber: "ORD-000302", status: "PLACED", placedAt: new Date("2026-03-01T00:00:00Z"), guestName: "Omar Khaled" });
    await seed({ orderNumber: "ORD-000303", status: "IN_TRANSIT" });
    await seed({ orderNumber: "ORD-000304", status: "COLLECTED" });
    await seed({ orderNumber: "ORD-000305", status: "READY_FOR_PICKUP", fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "S", address: "a", phone: "1" } } });

    const board = await (await owner.call(getBoard, "/api/admin/orders/board")).json();
    expect(board.columns.map((column: { status: string }) => column.status)).toEqual(["PLACED", "CONFIRMED", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "IN_TRANSIT"]);
    const placed = board.columns[0];
    expect(placed.total).toBe(2);
    expect(placed.orders.map((card: { orderNumber: string }) => card.orderNumber)).toEqual(["ORD-000302", "ORD-000301"]);
    expect(JSON.stringify(board)).not.toContain("ORD-000304"); // COLLECTED is not work

    const pickupOnly = await (await owner.call(getBoard, "/api/admin/orders/board?mode=PICKUP")).json();
    expect(pickupOnly.columns.flatMap((column: { orders: unknown[] }) => column.orders)).toHaveLength(1);
    const searched = await (await owner.call(getBoard, "/api/admin/orders/board?search=omar")).json();
    expect(searched.columns[0].orders.map((card: { orderNumber: string }) => card.orderNumber)).toEqual(["ORD-000302"]);
  });

  it("NEGATIVE: the board and the list need Order.read", async () => {
    const nobody = await signInWithPermissions([CustomPermission.PAYMENT_VERIFY]);
    expect((await nobody.call(getBoard, "/x")).status).toBe(403);
    expect((await nobody.call(getList, "/x")).status).toBe(403);
  });
});

describe("invoice, packing slip and picking list", () => {
  it("serves the invoice and the packing slip to Order.readOne; the slip carries no money, the invoice does", async () => {
    const reader = await signInWithPermissions([AppPermission.ORDER.READ_ONE]);
    const doc = await seed();
    const invoice = await (await reader.call(getInvoice, "/x", { params: { id: doc._id.toString() } })).json();
    expect(invoice).toMatchObject({ invoiceNumber: doc.invoiceNumber, lines: [{ sku: "SKU-1", quantity: 2 }] });
    expect(invoice.total).toBeDefined();

    const slip = await (await reader.call(getSlip, "/x", { params: { id: doc._id.toString() } })).json();
    expect(slip).toMatchObject({ orderNumber: doc.orderNumber, totalUnits: 2, notes: "Ring twice", shipTo: { recipientName: "Sara Hany" } });
    expect(Object.keys(slip)).not.toContain("total");
    expect(JSON.stringify(slip)).not.toMatch(/unitPrice|lineTotal|subtotal/);
  });

  it("the invoice of an order with no invoice is a 404", async () => {
    const owner = await signInAsOwner();
    const doc = await seed({ invoiceNumber: undefined, invoiceSnapshot: undefined });
    expect((await owner.call(getInvoice, "/x", { params: { id: doc._id.toString() } })).status).toBe(404);
  });

  it("aggregates a picking list per SKU across the selected orders, reporting what it skipped and what it could not find", async () => {
    const owner = await signInAsOwner();
    const a = await seed({ orderNumber: "ORD-000401" }, [["SKU-A", 2], ["SKU-B", 1]]);
    const b = await seed({ orderNumber: "ORD-000402" }, [["SKU-A", 3]]);
    const c = await seed({ orderNumber: "ORD-000403", status: "CANCELLED" }, [["SKU-A", 9]]);
    const ghost = new mongoose.Types.ObjectId().toString();

    const response = await owner.call(getPicking, `/api/admin/orders/picking-list?ids=${[a._id, b._id, c._id, ghost].join(",")}`);
    const list = await response.json();
    expect(response.status).toBe(200);
    expect(list.items.map((item: { sku: string; quantity: number }) => [item.sku, item.quantity])).toEqual([["SKU-A", 5], ["SKU-B", 1]]);
    expect(list.skipped).toEqual([{ orderNumber: "ORD-000403", reason: "CANCELLED" }]);
    expect(list.missing).toEqual([ghost]);
  });

  it("refuses a picking list with no ids, malformed ids, or none that exist", async () => {
    const owner = await signInAsOwner();
    expect((await owner.call(getPicking, "/api/admin/orders/picking-list")).status).toBe(400);
    expect((await owner.call(getPicking, "/api/admin/orders/picking-list?ids=nope")).status).toBe(400);
    expect((await owner.call(getPicking, `/api/admin/orders/picking-list?ids=${new mongoose.Types.ObjectId()}`)).status).toBe(404);
  });

  it("NEGATIVE: none of the three documents is served without the order permission (403)", async () => {
    const nobody = await signInWithPermissions([CustomPermission.PAYMENT_VERIFY, CustomPermission.ORDER_TRANSITION]);
    const doc = await seed();
    expect((await nobody.call(getInvoice, "/x", { params: { id: doc._id.toString() } })).status).toBe(403);
    expect((await nobody.call(getSlip, "/x", { params: { id: doc._id.toString() } })).status).toBe(403);
    expect((await nobody.call(getPicking, `/api/admin/orders/picking-list?ids=${doc._id}`)).status).toBe(403);
  });

  it("NEGATIVE: Order.readOne alone cannot pull a picking list across orders (it needs Order.read)", async () => {
    const readerOne = await signInWithPermissions([AppPermission.ORDER.READ_ONE]);
    const doc = await seed();
    expect((await readerOne.call(getPicking, `/api/admin/orders/picking-list?ids=${doc._id}`)).status).toBe(403);
  });
});
