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
import { ReturnModel, ReturnLineModel } from "src/server/commerce/return.schema";
import { ReturnSequenceModel } from "src/server/commerce/return-sequence.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
// Must be set before the route module is imported — see orders.integration.test.ts's identical note.
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { GET, POST } = await import("./route");

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

async function createDeliveredOrder(customerId: mongoose.Types.ObjectId) {
  const order = await OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
    customerId,
    status: "DELIVERED",
    placedAt: new Date(Date.now() - 60 * 60 * 1000),
    subtotal: new Decimal("100.00"),
    total: new Decimal("100.00"),
    fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
    payment: { method: "COD", status: "NOT_REQUIRED" },
    timeline: [
      { type: "ORDER_PLACED", at: new Date(Date.now() - 60 * 60 * 1000), actorType: "CUSTOMER" },
      { type: "ORDER_DELIVERED", at: new Date(), actorType: "STAFF" },
    ],
  });
  const line = await OrderLineModel.create({
    orderId: order._id,
    lineNumber: 1,
    variantId: new mongoose.Types.ObjectId(),
    sku: "SKU-1",
    productName: "Product",
    variantDescription: "Default",
    quantity: 5,
    unitPrice: new Decimal("20.00"),
    lineTotal: new Decimal("100.00"),
  });
  return { order, line };
}

function requestBody(orderNumber: string, orderLineId: string, quantity = 1) {
  return JSON.stringify({
    orderNumber,
    reason: "Changed my mind",
    lines: [{ orderLineId, quantity, reason: "Too small", condition: "Unopened" }],
  });
}

// One connect/disconnect pair for the whole file — `connectToDatabase()`
// memoises its connection on `globalThis` and never clears that cache on
// `mongoose.disconnect()`, so a second `beforeAll` in a later `describe`
// would see the stale cached (now-disconnected) connection and never
// actually reconnect.
beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await ReturnSequenceModel.deleteMany({});
  await RateLimitModel.deleteMany({});
  await mongoose.disconnect();
});

describe("POST /api/shop/returns - request return", () => {
  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await ReturnModel.deleteMany({});
    await ReturnLineModel.deleteMany({});
    await ReturnSequenceModel.deleteMany({});
    await RateLimitModel.deleteMany({});
  });

  it("creates a return successfully and returns 201", async () => {
    const customer = await createCustomer();
    const { order, line } = await createDeliveredOrder(customer._id);

    const request = new NextRequest("http://localhost/api/shop/returns", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "test-key-1", ...(await customerCookieHeader(customer._id.toString())) },
      body: requestBody(order.orderNumber, line._id.toString()),
    });

    const response = await POST(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.returnNumber).toMatch(/^RET-\d{6}$/);
    expect(body.status).toBe("REQUESTED");
  });

  it("returns 401 when no auth cookie is present", async () => {
    const request = new NextRequest("http://localhost/api/shop/returns", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "test-key-2" },
      body: requestBody("ORD-000001", new mongoose.Types.ObjectId().toString()),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
  });

  it("returns 400 when the Idempotency-Key header is missing", async () => {
    const customer = await createCustomer();
    const { order, line } = await createDeliveredOrder(customer._id);

    const request = new NextRequest("http://localhost/api/shop/returns", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: requestBody(order.orderNumber, line._id.toString()),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty lines array", async () => {
    const customer = await createCustomer();
    const { order } = await createDeliveredOrder(customer._id);

    const request = new NextRequest("http://localhost/api/shop/returns", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "test-key-3", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({ orderNumber: order.orderNumber, reason: "x", lines: [] }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
  });

  it("returns cached response on idempotent replay with the identical request, and does not create a second Return", async () => {
    const customer = await createCustomer();
    const { order, line } = await createDeliveredOrder(customer._id);
    const cookie = await customerCookieHeader(customer._id.toString());

    const makeRequest = () =>
      new NextRequest("http://localhost/api/shop/returns", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "replay-key", ...cookie },
        body: requestBody(order.orderNumber, line._id.toString()),
      });

    const response1 = await POST(makeRequest(), { params: Promise.resolve({}) });
    const body1 = await response1.json();
    expect(response1.status).toBe(201);

    const response2 = await POST(makeRequest(), { params: Promise.resolve({}) });
    const body2 = await response2.json();

    expect(response2.status).toBe(201);
    expect(body2.returnId).toBe(body1.returnId);
    expect(await ReturnModel.countDocuments({ orderId: order._id })).toBe(1);
  });

  it("rejects the same Idempotency-Key reused with a genuinely different request", async () => {
    const customer = await createCustomer();
    const { order, line } = await createDeliveredOrder(customer._id);
    const cookie = await customerCookieHeader(customer._id.toString());

    const first = new NextRequest("http://localhost/api/shop/returns", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "reuse-key", ...cookie },
      body: requestBody(order.orderNumber, line._id.toString(), 1),
    });
    const response1 = await POST(first, { params: Promise.resolve({}) });
    expect(response1.status).toBe(201);

    const second = new NextRequest("http://localhost/api/shop/returns", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "reuse-key", ...cookie },
      body: requestBody(order.orderNumber, line._id.toString(), 2),
    });
    const response2 = await POST(second, { params: Promise.resolve({}) });

    expect(response2.status).toBe(422);
  });

  it("rate-limits repeated return requests from the same customer", async () => {
    const customer = await createCustomer();
    const cookie = await customerCookieHeader(customer._id.toString());

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const { order, line } = await createDeliveredOrder(customer._id);
      const request = new NextRequest("http://localhost/api/shop/returns", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": `rate-key-${i}`, ...cookie },
        body: requestBody(order.orderNumber, line._id.toString()),
      });
      const response = await POST(request, { params: Promise.resolve({}) });
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});

describe("GET /api/shop/returns - list returns", () => {
  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await OrderModel.deleteMany({});
    await ReturnModel.deleteMany({});
    await ReturnLineModel.deleteMany({});
  });

  it("returns only the authenticated customer's returns", async () => {
    const customer1 = await createCustomer();
    const customer2 = await createCustomer();

    const order1 = await OrderModel.create({
      orderNumber: "ORD-100001",
      idempotencyKey: "test-key-a",
      customerId: customer1._id,
      status: "DELIVERED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    await ReturnModel.create({
      orderId: order1._id,
      customerId: customer1._id,
      returnNumber: "RET-100001",
      reason: "x",
      status: "REQUESTED",
      requestedAt: new Date(),
    });

    const order2 = await OrderModel.create({
      orderNumber: "ORD-100002",
      idempotencyKey: "test-key-b",
      customerId: customer2._id,
      status: "DELIVERED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    await ReturnModel.create({
      orderId: order2._id,
      customerId: customer2._id,
      returnNumber: "RET-100002",
      reason: "x",
      status: "REQUESTED",
      requestedAt: new Date(),
    });

    const request = new NextRequest("http://localhost/api/shop/returns", {
      headers: await customerCookieHeader(customer1._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].returnNumber).toBe("RET-100001");
  });

  it("returns 401 when no auth cookie is present", async () => {
    const request = new NextRequest("http://localhost/api/shop/returns");

    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
  });
});
