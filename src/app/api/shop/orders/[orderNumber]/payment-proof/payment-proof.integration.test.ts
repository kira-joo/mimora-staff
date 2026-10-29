import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { OTHER_RECEIPT_JPEG, RECEIPT_JPEG } from "../../../test-support/receipt-fixtures";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";

vi.mock("src/server/core/assets/asset-providers", () => ({
  privateAssets: vi.fn(),
}));

import { connectToDatabase } from "src/server/core/db/connect";
import { customerJwtConfig } from "src/server/core/auth/customer-jwt-config";
import { CUSTOMER_SESSION_COOKIE } from "src/server/core/auth/customer-session-cookies";
import { CustomerModel } from "src/server/identity/customer.schema";
import { OrderModel } from "src/server/commerce/order.schema";
import { PaymentProofModel } from "src/server/commerce/payment-proof.schema";
import { PaymentSettingsModel } from "src/server/fulfilment/payment-settings.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { privateAssets } from "src/server/core/assets/asset-providers";

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

async function createPaymentSettings() {
  return PaymentSettingsModel.create({
    methods: [{ method: "TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }],
  });
}

async function createOrder(customerId: mongoose.Types.ObjectId, overrides: Partial<Record<string, unknown>> = {}) {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
    customerId,
    status: "PLACED",
    placedAt: new Date(),
    subtotal: new Decimal("100.00"),
    total: new Decimal("100.00"),
    fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
    payment: { method: "TRANSFER", status: "AWAITING_PAYMENT" },
    ...overrides,
  });
}

function mockUpload(ref: { publicId: string; format: string; bytes: number } = { publicId: "payment-proofs/abc", format: "jpg", bytes: 16 }) {
  const upload = vi.fn().mockResolvedValue(ref);
  const destroy = vi.fn().mockResolvedValue(undefined);
  vi.mocked(privateAssets).mockReturnValue({ upload, destroy, signedUrl: vi.fn() } as unknown as ReturnType<typeof privateAssets>);
  return { upload, destroy };
}

function buildMultipartRequest(
  url: string,
  options: { headers?: Record<string, string>; fileField?: string; fileBuffer?: Uint8Array; filename?: string; mimeType?: string; omitFile?: boolean }
): NextRequest {
  const form = new FormData();
  if (!options.omitFile) {
    const bytes = options.fileBuffer ?? RECEIPT_JPEG;
    const file = new File([bytes as BlobPart], options.filename ?? "receipt.jpg", { type: options.mimeType ?? "image/jpeg" });
    form.append(options.fileField ?? "proof", file);
  }
  return new NextRequest(url, { method: "POST", headers: options.headers, body: form });
}

const URL = "http://localhost/api/shop/orders/ORD-000001/payment-proof";

describe("POST /api/shop/orders/[orderNumber]/payment-proof", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    // PaymentSettings is a singleton this file writes; RateLimit rows from
    // the rate-limiting test persist past their own test otherwise. Clear
    // both so a later test file sharing this database doesn't inherit them.
    await PaymentSettingsModel.deleteMany({});
    await RateLimitModel.deleteMany({});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await OrderModel.deleteMany({});
    await PaymentProofModel.deleteMany({});
    await PaymentSettingsModel.deleteMany({});
    await RateLimitModel.deleteMany({});
    vi.clearAllMocks();
  });

  it("submits proof successfully and returns 201", async () => {
    const customer = await createCustomer();
    await createPaymentSettings();
    const order = await createOrder(customer._id);
    mockUpload();

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-1", ...(await customerCookieHeader(customer._id.toString())) },
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.paymentStatus).toBe("SUBMITTED");
    expect(await PaymentProofModel.countDocuments({ orderId: order._id })).toBe(1);
  });

  it("returns 404 — the same as a missing order — when no credentials are present", async () => {
    const request = buildMultipartRequest(URL, { headers: { "Idempotency-Key": "test-key-2" } });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: "ORD-000001" }) });

    expect(response.status).toBe(404);
  });

  it("returns 404 when the order does not exist", async () => {
    const customer = await createCustomer();
    mockUpload();

    const request = buildMultipartRequest(URL, {
      headers: { "Idempotency-Key": "test-key-3", ...(await customerCookieHeader(customer._id.toString())) },
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: "ORD-000001" }) });

    expect(response.status).toBe(404);
  });

  it("returns 404 when the order belongs to a different customer", async () => {
    const owner = await createCustomer();
    const intruder = await createCustomer();
    await createPaymentSettings();
    const order = await createOrder(owner._id);
    mockUpload();

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-4", ...(await customerCookieHeader(intruder._id.toString())) },
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response.status).toBe(404);
  });

  it("returns 404 when the payment method is not configured", async () => {
    const customer = await createCustomer();
    const order = await createOrder(customer._id); // no PaymentSettings created
    mockUpload();

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-5", ...(await customerCookieHeader(customer._id.toString())) },
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response.status).toBe(404);
  });

  it("returns 404 when the payment method is disabled", async () => {
    const customer = await createCustomer();
    await PaymentSettingsModel.create({
      methods: [{ method: "TRANSFER", enabled: false, order: 0, requiresProof: true, requiresProviderIntegration: false }],
    });
    const order = await createOrder(customer._id);
    mockUpload();

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-6", ...(await customerCookieHeader(customer._id.toString())) },
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response.status).toBe(404);
  });

  it("returns 409 when the payment method does not require proof", async () => {
    const customer = await createCustomer();
    await PaymentSettingsModel.create({
      methods: [{ method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false }],
    });
    const order = await createOrder(customer._id, { payment: { method: "COD", status: "NOT_REQUIRED" } });
    mockUpload();

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-7", ...(await customerCookieHeader(customer._id.toString())) },
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response.status).toBe(409);
  });

  it("returns 409 when the current payment status does not allow submission", async () => {
    const customer = await createCustomer();
    await createPaymentSettings();
    const order = await createOrder(customer._id, { payment: { method: "TRANSFER", status: "VERIFIED" } });
    mockUpload();

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-8", ...(await customerCookieHeader(customer._id.toString())) },
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response.status).toBe(409);
  });

  it("returns 400 when no file is submitted", async () => {
    const customer = await createCustomer();
    await createPaymentSettings();
    const order = await createOrder(customer._id);

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-9", ...(await customerCookieHeader(customer._id.toString())) },
      omitFile: true,
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response.status).toBe(400);
  });

  it("returns 400 for an unsupported mime type", async () => {
    const customer = await createCustomer();
    await createPaymentSettings();
    const order = await createOrder(customer._id);

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-10", ...(await customerCookieHeader(customer._id.toString())) },
      mimeType: "application/pdf",
      filename: "receipt.pdf",
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response.status).toBe(400);
  });

  it("returns 400 for a disguised file — the server reads the bytes, not the label — and stores nothing", async () => {
    const customer = await createCustomer();
    await createPaymentSettings();
    const order = await createOrder(customer._id);

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-disguised", ...(await customerCookieHeader(customer._id.toString())) },
      fileBuffer: new TextEncoder().encode("%PDF-1.4 not a receipt image"),
      mimeType: "image/jpeg",
      filename: "receipt.jpg",
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response.status).toBe(400);
    expect(await PaymentProofModel.countDocuments({ orderId: order._id })).toBe(0);
  });

  it("returns 400 for a file exceeding the size limit", async () => {
    const customer = await createCustomer();
    await createPaymentSettings();
    const order = await createOrder(customer._id);

    const oversized = new Uint8Array(9 * 1024 * 1024); // policy caps at 8MB

    const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "test-key-11", ...(await customerCookieHeader(customer._id.toString())) },
      fileBuffer: oversized,
    });

    const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response.status).toBe(400);
  }, 15000);

  it("returns cached response on idempotent replay with the identical file, and does not create a second PaymentProof", async () => {
    const customer = await createCustomer();
    await createPaymentSettings();
    const order = await createOrder(customer._id);
    const { upload } = mockUpload();
    const cookie = await customerCookieHeader(customer._id.toString());

    const makeRequest = () =>
      buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
        headers: { "Idempotency-Key": "replay-key", ...cookie },
      });

    const response1 = await POST(makeRequest(), { params: Promise.resolve({ orderNumber: order.orderNumber }) });
    const body1 = await response1.json();
    expect(response1.status).toBe(201);

    const response2 = await POST(makeRequest(), { params: Promise.resolve({ orderNumber: order.orderNumber }) });
    const body2 = await response2.json();

    expect(response2.status).toBe(201);
    expect(body2.proofId).toBe(body1.proofId);
    expect(upload).toHaveBeenCalledTimes(1); // not re-uploaded on replay
    expect(await PaymentProofModel.countDocuments({ orderId: order._id })).toBe(1);
  });

  it("rejects the same Idempotency-Key reused with a genuinely different file", async () => {
    const customer = await createCustomer();
    await createPaymentSettings();
    const order = await createOrder(customer._id);
    mockUpload();
    const cookie = await customerCookieHeader(customer._id.toString());

    const first = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "reuse-key", ...cookie },
      fileBuffer: RECEIPT_JPEG,
    });
    const response1 = await POST(first, { params: Promise.resolve({ orderNumber: order.orderNumber }) });
    expect(response1.status).toBe(201);

    const second = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
      headers: { "Idempotency-Key": "reuse-key", ...cookie },
      fileBuffer: OTHER_RECEIPT_JPEG,
    });
    const response2 = await POST(second, { params: Promise.resolve({ orderNumber: order.orderNumber }) });

    expect(response2.status).toBe(422);
  });

  it("rate-limits repeated submissions from the same customer", async () => {
    const customer = await createCustomer();
    await createPaymentSettings();
    mockUpload();
    const cookie = await customerCookieHeader(customer._id.toString());

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const order = await createOrder(customer._id);
      const request = buildMultipartRequest(`http://localhost/api/shop/orders/${order.orderNumber}/payment-proof`, {
        headers: { "Idempotency-Key": `rate-key-${i}`, ...cookie },
      });
      const response = await POST(request, { params: Promise.resolve({ orderNumber: order.orderNumber }) });
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});
