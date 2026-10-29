import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import { connectToDatabase } from "src/server/core/db/connect";
import { customerJwtConfig } from "src/server/core/auth/customer-jwt-config";
import { CUSTOMER_SESSION_COOKIE } from "src/server/core/auth/customer-session-cookies";
import { CustomerModel } from "src/server/identity/customer.schema";
import { OrderModel, OrderLineModel } from "src/server/commerce/order.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
// Must be set before the route modules are imported — see orders.integration.test.ts's identical note.
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { GET } = await import("./route");
const { POST: CANCEL } = await import("./cancel/route");

async function createCustomer() {
  return CustomerModel.create({
    phone: `+2010${Math.floor(Math.random() * 100000000)}`,
    passwordHash: "irrelevant-for-this-test",
    name: "Test Customer",
    tokenVersion: 1,
  });
}

async function customerCookieHeader(customerId: string): Promise<Record<string, string>> {
  const token = await signAuthToken({ sub: customerId, tokenVersion: 1 }, undefined, customerJwtConfig());
  return { cookie: `${CUSTOMER_SESSION_COOKIE}=${token}` };
}

async function createFulfilmentSettings(customerCancelWindowMinutes = 30) {
  return FulfilmentSettingsModel.create({
    deliveryEnabled: true,
    pickupEnabled: true,
    shippingFeeMode: "FLAT",
    flatShippingFee: new Decimal("5.00"),
    defaultDispatchLeadDays: 2,
    cutoffTime: "14:00",
    orderMinimum: new Decimal("0"),
    customerCancelWindowMinutes,
    tax: { mode: "INCLUDED", rate: 0 },
  });
}

// One connect/disconnect pair for the whole file — see orders.integration.test.ts's identical note.
beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  // FulfilmentSettings is a singleton this file writes; clear it so a later
  // test file sharing this database doesn't inherit it.
  await FulfilmentSettingsModel.deleteMany({});
  await mongoose.disconnect();
});

describe("GET /api/shop/orders/[orderNumber] - get order detail", () => {
  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await FulfilmentSettingsModel.deleteMany({});
  });

  it("returns full order detail with lines", async () => {
    const customer = await createCustomer();
    await createFulfilmentSettings();

    const order = await OrderModel.create({
      orderNumber: "ORD-009001",
      idempotencyKey: "ORD-009001",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("150.00"),
      discount: new Decimal("10.00"),
      tax: new Decimal("5.00"),
      total: new Decimal("145.00"),
      fulfilment: {
        mode: "DELIVERY",
        fee: new Decimal("5.00"),
        zone: "Zone A",
        addressSnapshot: {
          recipientName: "Jane Doe",
          phone: "555-0300",
          addressLine1: "789 Oak St",
          city: "City",
          governorate: "Gov",
        },
      },
      payment: { method: "TRANSFER", status: "AWAITING_PAYMENT" },
    });

    await OrderLineModel.create([
      {
        orderId: order._id,
        lineNumber: 1,
        variantId: new mongoose.Types.ObjectId(),
        sku: "SKU-A",
        productName: "Product A",
        variantDescription: "Size M",
        quantity: 2,
        unitPrice: new Decimal("50.00"),
        lineTotal: new Decimal("100.00"),
      },
      {
        orderId: order._id,
        lineNumber: 2,
        variantId: new mongoose.Types.ObjectId(),
        sku: "SKU-B",
        productName: "Product B",
        variantDescription: "Default",
        quantity: 1,
        unitPrice: new Decimal("50.00"),
        lineTotal: new Decimal("50.00"),
      },
    ]);

    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009001", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({ orderNumber: "ORD-009001" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.orderNumber).toBe("ORD-009001");
    expect(body.status).toBe("PLACED");
    expect(new Decimal(body.subtotal).toFixed(2)).toBe("150.00");
    expect(new Decimal(body.discount).toFixed(2)).toBe("10.00");
    expect(new Decimal(body.tax).toFixed(2)).toBe("5.00");
    expect(new Decimal(body.total).toFixed(2)).toBe("145.00");
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0].sku).toBe("SKU-A");
    expect(body.fulfilment.mode).toBe("DELIVERY");
    expect(body.fulfilment.addressSnapshot.recipientName).toBe("Jane Doe");
    expect(body.canCancel).toBe(true);
  });

  it("returns 404 — the same as a missing order — when no credentials are present", async () => {
    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009001");

    const response = await GET(request, { params: Promise.resolve({ orderNumber: "ORD-009001" }) });

    expect(response.status).toBe(404);
  });

  it("returns 404 when order does not exist", async () => {
    const customer = await createCustomer();

    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009999", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({ orderNumber: "ORD-009999" }) });

    expect(response.status).toBe(404);
  });

  it("returns 404 when order belongs to a different customer", async () => {
    const customer1 = await createCustomer();
    const customer2 = await createCustomer();

    await OrderModel.create({
      orderNumber: "ORD-009002",
      idempotencyKey: "ORD-009002",
      customerId: customer1._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009002", {
      headers: await customerCookieHeader(customer2._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({ orderNumber: "ORD-009002" }) });

    expect(response.status).toBe(404);
  });

  it("returns canCancel=false when outside the cancellation window", async () => {
    const customer = await createCustomer();
    await createFulfilmentSettings();

    const placedAt = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago

    await OrderModel.create({
      orderNumber: "ORD-009003",
      idempotencyKey: "ORD-009003",
      customerId: customer._id,
      status: "PLACED",
      placedAt,
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009003", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({ orderNumber: "ORD-009003" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.canCancel).toBe(false);
  });

  it("returns 400 for an empty orderNumber parameter", async () => {
    const customer = await createCustomer();

    const request = new NextRequest("http://localhost/api/shop/orders/%20", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({ orderNumber: " " }) });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/shop/orders/[orderNumber]/cancel - cancel order", () => {
  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await FulfilmentSettingsModel.deleteMany({});
  });

  it("cancels order successfully", async () => {
    const customer = await createCustomer();
    await createFulfilmentSettings();

    const placedAt = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

    await OrderModel.create({
      orderNumber: "ORD-009101",
      idempotencyKey: "ORD-009101",
      customerId: customer._id,
      status: "PLACED",
      placedAt,
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009101/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({ reason: "Changed my mind" }),
    });

    const response = await CANCEL(request, { params: Promise.resolve({ orderNumber: "ORD-009101" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    const updatedOrder = await OrderModel.findOne({ orderNumber: "ORD-009101" });
    expect(updatedOrder?.status).toBe("CANCELLED");
  });

  it("returns 404 — the same as a missing order — when no credentials are present", async () => {
    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009101/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Test" }),
    });

    const response = await CANCEL(request, { params: Promise.resolve({ orderNumber: "ORD-009101" }) });

    expect(response.status).toBe(404);
  });

  it("returns 404 when order does not exist", async () => {
    const customer = await createCustomer();

    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009999/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({}),
    });

    const response = await CANCEL(request, { params: Promise.resolve({ orderNumber: "ORD-009999" }) });

    expect(response.status).toBe(404);
  });

  it("returns 404 when order belongs to a different customer", async () => {
    const customer1 = await createCustomer();
    const customer2 = await createCustomer();
    await createFulfilmentSettings();

    await OrderModel.create({
      orderNumber: "ORD-009102",
      idempotencyKey: "ORD-009102",
      customerId: customer1._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009102/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer2._id.toString())) },
      body: JSON.stringify({}),
    });

    const response = await CANCEL(request, { params: Promise.resolve({ orderNumber: "ORD-009102" }) });

    expect(response.status).toBe(404);
  });

  it("returns 409 when outside the cancellation window", async () => {
    const customer = await createCustomer();
    await createFulfilmentSettings();

    const placedAt = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago

    await OrderModel.create({
      orderNumber: "ORD-009103",
      idempotencyKey: "ORD-009103",
      customerId: customer._id,
      status: "PLACED",
      placedAt,
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009103/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({}),
    });

    const response = await CANCEL(request, { params: Promise.resolve({ orderNumber: "ORD-009103" }) });

    expect(response.status).toBe(409);
  });

  it("accepts an omitted reason and defaults it", async () => {
    const customer = await createCustomer();
    await createFulfilmentSettings();

    await OrderModel.create({
      orderNumber: "ORD-009104",
      idempotencyKey: "ORD-009104",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const request = new NextRequest("http://localhost/api/shop/orders/ORD-009104/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({}),
    });

    const response = await CANCEL(request, { params: Promise.resolve({ orderNumber: "ORD-009104" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("returns 400 for an empty orderNumber parameter", async () => {
    const customer = await createCustomer();

    const request = new NextRequest("http://localhost/api/shop/orders/%20/cancel", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({}),
    });

    const response = await CANCEL(request, { params: Promise.resolve({ orderNumber: " " }) });

    expect(response.status).toBe(400);
  });
});
