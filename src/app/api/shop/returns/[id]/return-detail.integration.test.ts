import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import { connectToDatabase } from "src/server/core/db/connect";
import { customerJwtConfig } from "src/server/core/auth/customer-jwt-config";
import { CUSTOMER_SESSION_COOKIE } from "src/server/core/auth/customer-session-cookies";
import { CustomerModel } from "src/server/identity/customer.schema";
import { OrderModel } from "src/server/commerce/order.schema";
import { ReturnModel, ReturnLineModel } from "src/server/commerce/return.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { GET } = await import("./route");

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

describe("GET /api/shop/returns/[id] - return detail", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await OrderModel.deleteMany({});
    await ReturnModel.deleteMany({});
    await ReturnLineModel.deleteMany({});
  });

  it("returns full detail for a return the customer owns", async () => {
    const customer = await createCustomer();
    const order = await OrderModel.create({
      orderNumber: "ORD-000001",
      idempotencyKey: "test-key-1",
      customerId: customer._id,
      status: "DELIVERED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    const ret = await ReturnModel.create({
      orderId: order._id,
      customerId: customer._id,
      returnNumber: "RET-000001",
      reason: "Changed my mind",
      status: "REQUESTED",
      requestedAt: new Date(),
    });

    const request = new NextRequest(`http://localhost/api/shop/returns/${ret._id.toString()}`, {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({ id: ret._id.toString() }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.returnNumber).toBe("RET-000001");
    expect(body.orderNumber).toBe("ORD-000001");
  });

  it("returns 401 when no auth cookie is present", async () => {
    const id = new mongoose.Types.ObjectId().toString();
    const request = new NextRequest(`http://localhost/api/shop/returns/${id}`);

    const response = await GET(request, { params: Promise.resolve({ id }) });

    expect(response.status).toBe(401);
  });

  it("returns 404 for a nonexistent return", async () => {
    const customer = await createCustomer();
    const id = new mongoose.Types.ObjectId().toString();

    const request = new NextRequest(`http://localhost/api/shop/returns/${id}`, {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({ id }) });

    expect(response.status).toBe(404);
  });

  it("returns 404 for another customer's return", async () => {
    const owner = await createCustomer();
    const intruder = await createCustomer();
    const order = await OrderModel.create({
      orderNumber: "ORD-000002",
      idempotencyKey: "test-key-2",
      customerId: owner._id,
      status: "DELIVERED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    const ret = await ReturnModel.create({
      orderId: order._id,
      customerId: owner._id,
      returnNumber: "RET-000002",
      reason: "x",
      status: "REQUESTED",
      requestedAt: new Date(),
    });

    const request = new NextRequest(`http://localhost/api/shop/returns/${ret._id.toString()}`, {
      headers: await customerCookieHeader(intruder._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({ id: ret._id.toString() }) });

    expect(response.status).toBe(404);
  });

  it("returns 400 for an invalid Mongo id", async () => {
    const customer = await createCustomer();

    const request = new NextRequest("http://localhost/api/shop/returns/not-a-mongo-id", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({ id: "not-a-mongo-id" }) });

    expect(response.status).toBe(400);
  });
});
