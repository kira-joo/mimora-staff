import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { OrderLineModel, OrderModel } from "src/server/commerce/order.schema";
import { CustomerModel } from "src/server/identity/customer.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { deriveOrderAccessToken } from "src/server/shop/order/order-access-token";
import { callShopRoute, type ShopRouteHandler } from "../../../test-support/shop-route-harness";

/** The customer's invoice and the order detail's new fields: who may read them, and what they say. */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { GET: INVOICE } = (await import("./route")) as unknown as { GET: ShopRouteHandler };
const { GET: DETAIL } = (await import("../route")) as unknown as { GET: ShopRouteHandler };

const clean = () => Promise.all([OrderModel.deleteMany({}), OrderLineModel.deleteMany({}), CustomerModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({})]);
beforeAll(connectToDatabase);
afterAll(async () => {
  await clean();
  await mongoose.disconnect();
});
beforeEach(clean);

async function order(overrides: Record<string, unknown> = {}, withInvoice = true) {
  const doc = await OrderModel.create({
    orderNumber: `ORD-${Math.floor(Math.random() * 1e9)}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestName: "Sara",
    guestPhone: "+201001112223",
    status: "PLACED",
    placedAt: new Date("2026-03-01T10:00:00Z"),
    subtotal: new Decimal("100"),
    total: new Decimal("100"),
    fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
    payment: { method: "COD", status: "NOT_REQUIRED" },
    ...(withInvoice ? { invoiceNumber: `INV-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`, invoiceSnapshot: { issuedAt: new Date("2026-03-01T10:00:00Z"), seller: { name: { en: "Acme", ar: "أكمي" } }, tax: { mode: "ADDED", rate: 0 } } } : {}),
    ...overrides,
  });
  await OrderLineModel.create({ orderId: doc._id, lineNumber: 1, variantId: new mongoose.Types.ObjectId(), sku: "SKU-1", productName: "Shirt", variantDescription: "M", quantity: 1, unitPrice: new Decimal("100"), lineTotal: new Decimal("100") });
  return doc;
}
const token = (doc: { _id: mongoose.Types.ObjectId }) => ({ "x-order-access-token": deriveOrderAccessToken(doc._id.toString()) });
const get = (doc: { orderNumber: string }, init: Parameters<typeof callShopRoute>[2] = {}) => callShopRoute(INVOICE, `/x`, { params: { orderNumber: doc.orderNumber }, ...init });

describe("GET /api/shop/orders/[orderNumber]/invoice — access control", () => {
  it("a guest holding the order's token gets the invoice", async () => {
    const doc = await order();
    const result = await get(doc, { headers: token(doc) });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ invoiceNumber: doc.invoiceNumber, orderNumber: doc.orderNumber, status: "ISSUED", lines: [{ sku: "SKU-1", quantity: 1 }] });
  });

  it("a guest without the token, with a wrong one, or with another order's token gets the same 404 as a missing order", async () => {
    const doc = await order();
    const other = await order();
    const missing = await callShopRoute(INVOICE, "/x", { params: { orderNumber: "ORD-NOPE" } });
    for (const headers of [{}, { "x-order-access-token": "wrong" }, token(other)]) {
      const result = await get(doc, { headers });
      expect(result.status).toBe(404);
      expect(result.body).toEqual(missing.body);
    }
  });

  it("another signed-in customer cannot read a customer's invoice, and a token never opens a customer's order; the owner can", async () => {
    const owner = await CustomerModel.create({ phone: "+201000000911", passwordHash: "x", name: "Owner", tokenVersion: 1 });
    const intruder = await CustomerModel.create({ phone: "+201000000912", passwordHash: "x", name: "Intruder", tokenVersion: 1 });
    const owned = await order({ customerId: owner._id, guestName: undefined, guestPhone: undefined });

    expect((await get(owned, { customerId: intruder._id.toString() })).status).toBe(404);
    expect((await get(owned, { headers: token(owned) })).status).toBe(404);
    const own = await get(owned, { customerId: owner._id.toString() });
    expect(own.status).toBe(200);
    expect(own.body.billTo.name).toBe("Owner");
  });

  it("an order placed before invoices existed has no invoice: 404, even for its owner's token", async () => {
    const doc = await order({}, false);
    expect((await get(doc, { headers: token(doc) })).status).toBe(404);
  });

  it("a cancelled order's invoice is still readable and reads VOID with the same number", async () => {
    const doc = await order({ status: "CANCELLED", timeline: [{ type: "ORDER_CANCELLED", at: new Date(), actorType: "STAFF", reason: "internal note" }] });
    const result = await get(doc, { headers: token(doc) });
    expect(result.body).toMatchObject({ invoiceNumber: doc.invoiceNumber, status: "VOID" });
    expect(JSON.stringify(result.body)).not.toContain("internal note");
  });
});

describe("GET /api/shop/orders/[orderNumber] — notes, tracking and invoice number", () => {
  beforeEach(async () => {
    await FulfilmentSettingsModel.create({ deliveryEnabled: true, pickupEnabled: true, customerCancelWindowMinutes: 30, tax: { mode: "INCLUDED", rate: 0 } });
  });

  it("returns the customer's note, the tracking link and the invoice number", async () => {
    const doc = await order({
      notes: "Leave with the neighbour",
      status: "SHIPPED",
      fulfilment: { mode: "DELIVERY", fee: new Decimal("0"), addressSnapshot: { recipientName: "Sara", phone: "1", addressLine1: "x", city: "c", governorate: "g" } },
      tracking: { carrierKey: "aramex", carrierName: "Aramex", trackingNumber: "123", url: "https://aramex.example/123", updatedAt: new Date() },
    });
    const { body } = await callShopRoute(DETAIL, "/x", { params: { orderNumber: doc.orderNumber }, headers: token(doc) });
    expect(body.notes).toBe("Leave with the neighbour");
    expect(body.tracking).toEqual({ carrierName: "Aramex", trackingNumber: "123", url: "https://aramex.example/123" });
    expect(body.invoiceNumber).toBe(doc.invoiceNumber);
  });

  it("omits all three when there are none — and never exposes who entered the tracking", async () => {
    const doc = await order({}, false);
    const { body } = await callShopRoute(DETAIL, "/x", { params: { orderNumber: doc.orderNumber }, headers: token(doc) });
    expect(body).not.toHaveProperty("notes");
    expect(body).not.toHaveProperty("tracking");
    expect(body).not.toHaveProperty("invoiceNumber");
    expect(JSON.stringify(body)).not.toContain("updatedBy");
  });
});
