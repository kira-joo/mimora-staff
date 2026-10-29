import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import { connectToDatabase } from "src/server/core/db/connect";
import { customerJwtConfig } from "src/server/core/auth/customer-jwt-config";
import { CUSTOMER_SESSION_COOKIE } from "src/server/core/auth/customer-session-cookies";
import { CustomerModel } from "src/server/identity/customer.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { OrderModel, OrderLineModel } from "src/server/commerce/order.schema";
import { ReviewModel } from "src/server/content/review.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
// Must be set before the route module is imported — see orders.integration.test.ts's identical note.
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { POST } = await import("./route");

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

async function createPurchasedProduct(customerId: mongoose.Types.ObjectId, sku: string) {
  const product = await ProductModel.create({
    slug: `product-${sku.toLowerCase()}`,
    categoryId: new mongoose.Types.ObjectId(),
    name: { en: "Test Product", ar: "منتج" },
    lifecycle: "published",
  });
  const variant = await VariantModel.create({
    productId: product._id,
    sku,
    variantKey: `key-${sku}`,
    stock: 10,
    price: new Decimal("50.00"),
    backorderPolicy: "DENY",
  });
  const order = await OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
    customerId,
    status: "DELIVERED",
    placedAt: new Date(),
    subtotal: new Decimal("50.00"),
    total: new Decimal("50.00"),
    fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
    payment: { method: "COD", status: "NOT_REQUIRED" },
  });
  await OrderLineModel.create({
    orderId: order._id,
    lineNumber: 1,
    variantId: variant._id,
    sku,
    productName: "Product",
    variantDescription: "Default",
    quantity: 1,
    unitPrice: new Decimal("50.00"),
    lineTotal: new Decimal("50.00"),
  });
  return product;
}

function reviewBody(productId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({ productId, rating: 5, title: "Great", body: "Loved it", ...overrides });
}

describe("POST /api/shop/reviews", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await RateLimitModel.deleteMany({});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await ProductModel.deleteMany({});
    await VariantModel.deleteMany({});
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await ReviewModel.deleteMany({});
    await RateLimitModel.deleteMany({});
  });

  it("submits a review successfully and returns 201", async () => {
    const customer = await createCustomer();
    const product = await createPurchasedProduct(customer._id, "SKU-1");

    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: reviewBody(product._id.toString()),
    });

    const response = await POST(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.status).toBe("PENDING");
    expect(body.title).toEqual({ en: "Great", ar: "" });
  });

  it("resolves locale from Accept-Language and stores the text under that locale", async () => {
    const customer = await createCustomer();
    const product = await createPurchasedProduct(customer._id, "SKU-2");

    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "ar-EG,ar;q=0.9",
        ...(await customerCookieHeader(customer._id.toString())),
      },
      body: reviewBody(product._id.toString(), { title: "رائع", body: "ممتاز" }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.title).toEqual({ ar: "رائع", en: "" });
    expect(body.body).toEqual({ ar: "ممتاز", en: "" });
  });

  it("falls back to English when Accept-Language is absent, matching existing fallback behavior", async () => {
    const customer = await createCustomer();
    const product = await createPurchasedProduct(customer._id, "SKU-3");

    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: reviewBody(product._id.toString()),
    });

    const response = await POST(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(body.title).toEqual({ en: "Great", ar: "" });
  });

  it("returns 401 when no auth cookie is present", async () => {
    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: reviewBody(new mongoose.Types.ObjectId().toString()),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
  });

  it("returns 400 for a rating below 1", async () => {
    const customer = await createCustomer();
    const product = await createPurchasedProduct(customer._id, "SKU-4");

    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: reviewBody(product._id.toString(), { rating: 0 }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
  });

  it("returns 400 for a rating above 5", async () => {
    const customer = await createCustomer();
    const product = await createPurchasedProduct(customer._id, "SKU-5");

    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: reviewBody(product._id.toString(), { rating: 6 }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty title", async () => {
    const customer = await createCustomer();
    const product = await createPurchasedProduct(customer._id, "SKU-6");

    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: reviewBody(product._id.toString(), { title: "" }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty body", async () => {
    const customer = await createCustomer();
    const product = await createPurchasedProduct(customer._id, "SKU-7");

    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: reviewBody(product._id.toString(), { body: "" }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
  });

  it("returns 404 for a nonexistent product", async () => {
    const customer = await createCustomer();

    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: reviewBody(new mongoose.Types.ObjectId().toString()),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(404);
  });

  it("returns 409 when the customer never purchased the product", async () => {
    const customer = await createCustomer();
    const product = await ProductModel.create({
      slug: "unpurchased-product",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Unpurchased", ar: "غير مشترى" },
      lifecycle: "published",
    });

    const request = new NextRequest("http://localhost/api/shop/reviews", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: reviewBody(product._id.toString()),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(409);
  });

  it("rate-limits repeated review submissions from the same customer", async () => {
    const customer = await createCustomer();
    const cookie = await customerCookieHeader(customer._id.toString());

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const product = await createPurchasedProduct(customer._id, `SKU-RATE-${i}`);
      const request = new NextRequest("http://localhost/api/shop/reviews", {
        method: "POST",
        headers: { "content-type": "application/json", ...cookie },
        body: reviewBody(product._id.toString()),
      });
      const response = await POST(request, { params: Promise.resolve({}) });
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});
