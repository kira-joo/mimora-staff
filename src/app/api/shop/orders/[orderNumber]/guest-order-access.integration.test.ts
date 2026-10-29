import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RECEIPT_JPEG } from "../../test-support/receipt-fixtures";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { NextRequest } from "next/server";

vi.mock("src/server/core/assets/asset-providers", () => ({ privateAssets: vi.fn() }));

import { connectToDatabase } from "src/server/core/db/connect";
import { CUSTOMER_SESSION_COOKIE } from "src/server/core/auth/customer-session-cookies";
import { CustomerModel } from "src/server/identity/customer.schema";
import { OrderModel } from "src/server/commerce/order.schema";
import { PaymentProofModel } from "src/server/commerce/payment-proof.schema";
import { PaymentSettingsModel } from "src/server/fulfilment/payment-settings.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { privateAssets } from "src/server/core/assets/asset-providers";
import { deriveOrderAccessToken } from "src/server/shop/order/order-access-token";
import { callShopRoute, customerCookie, type ShopRouteHandler } from "../../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { GET } = (await import("./route")) as unknown as { GET: ShopRouteHandler };
const { POST: CANCEL } = (await import("./cancel/route")) as unknown as { POST: ShopRouteHandler };
const { POST: PROOF } = (await import("./payment-proof/route")) as unknown as { POST: ShopRouteHandler };

beforeAll(async () => {
  await connectToDatabase();
});
afterAll(async () => {
  await Promise.all([OrderModel.deleteMany({}), CustomerModel.deleteMany({}), PaymentSettingsModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({}), PaymentProofModel.deleteMany({})]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), CustomerModel.deleteMany({}), PaymentSettingsModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({}), PaymentProofModel.deleteMany({}), RateLimitModel.deleteMany({})]);
  await FulfilmentSettingsModel.create({ deliveryEnabled: true, pickupEnabled: true, shippingFeeMode: "FLAT", flatShippingFee: new Decimal("0"), defaultDispatchLeadDays: 1, orderMinimum: new Decimal("0"), customerCancelWindowMinutes: 30, tax: { mode: "INCLUDED", rate: 0 } });
  await PaymentSettingsModel.create({ methods: [{ method: "TRANSFER", enabled: true, order: 0, requiresProof: true, requiresProviderIntegration: false }] });
});

function guestOrder(overrides: Record<string, unknown> = {}) {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestName: "Sara",
    guestPhone: "+201001112223",
    status: "PLACED",
    placedAt: new Date(),
    subtotal: new Decimal("100"),
    total: new Decimal("100"),
    fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
    payment: {
      method: "TRANSFER",
      status: "AWAITING_PAYMENT",
      destinationSnapshot: { accountName: "Shop LLC", number: "0123" },
      instructionsSnapshot: { en: "Transfer then upload the receipt", ar: "حوّل ثم ارفع الإيصال" },
    },
    ...overrides,
  });
}

const tokenHeader = (order: { _id: mongoose.Types.ObjectId }) => ({ "x-order-access-token": deriveOrderAccessToken(order._id.toString()) });

function multipart(headers: Record<string, string>, orderNumber: string) {
  const form = new FormData();
  form.append("proof", new File([RECEIPT_JPEG as BlobPart], "receipt.jpg", { type: "image/jpeg" }));
  return PROOF(new NextRequest(`http://localhost/api/shop/orders/${orderNumber}/payment-proof`, { method: "POST", headers, body: form }), { params: Promise.resolve({ orderNumber }) });
}

describe("guest order access by token", () => {
  it("GET: a guest with the token sees the order, including the frozen payment destination and instructions", async () => {
    const order = await guestOrder();
    const { status, body } = await callShopRoute(GET, `/api/shop/orders/${order.orderNumber}`, { params: { orderNumber: order.orderNumber }, headers: tokenHeader(order) });

    expect(status).toBe(200);
    expect(body.orderNumber).toBe(order.orderNumber);
    expect(body.payment).toEqual({
      method: "TRANSFER",
      status: "AWAITING_PAYMENT",
      destination: { accountName: "Shop LLC", number: "0123" },
      instructions: { en: "Transfer then upload the receipt", ar: "حوّل ثم ارفع الإيصال" },
    });
    expect(body.canCancel).toBe(true);
  });

  it("GET: a rejected payment shows the staff reason; once resubmitted the reason is gone", async () => {
    const order = await guestOrder({ payment: { method: "TRANSFER", status: "REJECTED", verification: { rejectionReason: "Amount does not match" }, destinationSnapshot: { number: "0123" } } });
    const rejected = await callShopRoute(GET, `/x`, { params: { orderNumber: order.orderNumber }, headers: tokenHeader(order) });
    expect(rejected.body.payment).toMatchObject({ status: "REJECTED", rejectionReason: "Amount does not match", destination: { number: "0123" } });

    await OrderModel.updateOne({ _id: order._id }, { $set: { "payment.status": "SUBMITTED" } });
    const resubmitted = await callShopRoute(GET, `/x`, { params: { orderNumber: order.orderNumber }, headers: tokenHeader(order) });
    expect(resubmitted.body.payment).not.toHaveProperty("rejectionReason");
  });

  it("GET: wrong token, no token, and another order's token are all the same 404 as a missing order", async () => {
    const order = await guestOrder();
    const other = await guestOrder();
    const missing = await callShopRoute(GET, "/x", { params: { orderNumber: "ORD-NOPE" }, headers: tokenHeader(order) });

    for (const headers of [{ "x-order-access-token": "wrong" }, {}, tokenHeader(other)]) {
      const result = await callShopRoute(GET, "/x", { params: { orderNumber: order.orderNumber }, headers });
      expect(result.status).toBe(404);
      expect(result.body).toEqual(missing.body);
    }
    expect(missing.status).toBe(404);
  });

  it("GET: another customer's order is a 404 for a different signed-in customer, and a customer's order is never opened by a token", async () => {
    const owner = await CustomerModel.create({ phone: "+201000000901", passwordHash: "x", name: "Owner", tokenVersion: 1 });
    const intruder = await CustomerModel.create({ phone: "+201000000902", passwordHash: "x", name: "Intruder", tokenVersion: 1 });
    const owned = await guestOrder({ customerId: owner._id, guestName: undefined, guestPhone: undefined });

    expect((await callShopRoute(GET, "/x", { params: { orderNumber: owned.orderNumber }, customerId: intruder._id.toString() })).status).toBe(404);
    expect((await callShopRoute(GET, "/x", { params: { orderNumber: owned.orderNumber }, headers: tokenHeader(owned) })).status).toBe(404);
    expect((await callShopRoute(GET, "/x", { params: { orderNumber: owned.orderNumber }, customerId: owner._id.toString() })).status).toBe(200);
  });

  it("GET: a present-but-invalid customer session is still 401, not 404", async () => {
    const order = await guestOrder();
    const result = await callShopRoute(GET, "/x", { params: { orderNumber: order.orderNumber }, headers: { cookie: `${CUSTOMER_SESSION_COOKIE}=garbage` } });
    expect(result.status).toBe(401);
  });

  it("GET: a signed-in customer can still open a guest order they hold the token for", async () => {
    const customer = await CustomerModel.create({ phone: "+201000000903", passwordHash: "x", name: "C", tokenVersion: 1 });
    const order = await guestOrder();
    const result = await callShopRoute(GET, "/x", { params: { orderNumber: order.orderNumber }, headers: { ...tokenHeader(order), cookie: await customerCookie(customer._id.toString()) } });
    expect(result.status).toBe(200);
  });

  it("CANCEL: a guest cancels within the window by token; without it the order is untouched (404)", async () => {
    const order = await guestOrder({ payment: { method: "TRANSFER", status: "AWAITING_PAYMENT" } });

    const denied = await callShopRoute(CANCEL, "/x", { method: "POST", params: { orderNumber: order.orderNumber }, body: { reason: "x" } });
    expect(denied.status).toBe(404);
    expect((await OrderModel.findById(order._id))?.status).toBe("PLACED");

    const ok = await callShopRoute(CANCEL, "/x", { method: "POST", params: { orderNumber: order.orderNumber }, headers: tokenHeader(order), body: { reason: "Changed my mind" } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true });
    const stored = await OrderModel.findById(order._id).lean();
    expect(stored?.status).toBe("CANCELLED");
    expect(stored?.timeline.at(-1)).toMatchObject({ type: "ORDER_CANCELLED", actorType: "CUSTOMER" });
    expect(stored?.timeline.at(-1)?.actorId).toBeUndefined();
  });

  it("PAYMENT PROOF: a guest uploads by token (idempotent per order:<id>); no token is a 404 and uploads nothing", async () => {
    const upload = vi.fn().mockResolvedValue({ publicId: "payment-proofs/g1", format: "jpg", bytes: 4 });
    vi.mocked(privateAssets).mockReturnValue({ upload, destroy: vi.fn(), signedUrl: vi.fn() } as unknown as ReturnType<typeof privateAssets>);
    const order = await guestOrder();

    const denied = await multipart({ "Idempotency-Key": `p-${new mongoose.Types.ObjectId()}` }, order.orderNumber);
    expect(denied.status).toBe(404);
    expect(upload).not.toHaveBeenCalled();

    const key = `p-${new mongoose.Types.ObjectId()}`;
    const first = await multipart({ "Idempotency-Key": key, ...tokenHeader(order) }, order.orderNumber);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ paymentStatus: "SUBMITTED", proofId: expect.any(String) });
    expect((await OrderModel.findById(order._id))?.payment.status).toBe("SUBMITTED");

    const replay = await multipart({ "Idempotency-Key": key, ...tokenHeader(order) }, order.orderNumber);
    expect(replay.status).toBe(201);
    expect(await PaymentProofModel.countDocuments({ orderId: order._id })).toBe(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("GET: the timeline is customer-safe — chronological, exactly { type, at }, no internal events or staff text (guest token path)", async () => {
    const staff = new mongoose.Types.ObjectId();
    const order = await guestOrder({
      timeline: [
        { type: "PAYMENT_REJECTED", at: new Date("2026-01-01T12:00:00Z"), actorType: "STAFF", actorId: staff, reason: "staff-only wording", metadata: { note: "internal" } },
        { type: "ORDER_PLACED", at: new Date("2026-01-01T10:00:00Z"), actorType: "CUSTOMER" },
        { type: "RETURN_REQUESTED", at: new Date("2026-01-02T10:00:00Z"), actorType: "CUSTOMER", reason: "return reason" },
        { type: "ORDER_CONFIRMED", at: new Date("2026-01-01T11:00:00Z"), actorType: "STAFF", actorId: staff },
      ],
    });

    const { status, body } = await callShopRoute(GET, "/x", { params: { orderNumber: order.orderNumber }, headers: tokenHeader(order) });

    expect(status).toBe(200);
    expect(body.timeline).toEqual([
      { type: "ORDER_PLACED", at: "2026-01-01T10:00:00.000Z" },
      { type: "ORDER_CONFIRMED", at: "2026-01-01T11:00:00.000Z" },
      { type: "PAYMENT_REJECTED", at: "2026-01-01T12:00:00.000Z" },
    ]);
    for (const item of body.timeline) expect(Object.keys(item).sort()).toEqual(["at", "type"]);
    const text = JSON.stringify(body.timeline);
    for (const leak of [staff.toString(), "staff-only wording", "internal", "STAFF"]) expect(text).not.toContain(leak);
  });
});
