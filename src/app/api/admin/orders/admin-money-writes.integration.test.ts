import mongoose from "mongoose";
import { Decimal } from "decimal.js";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { ActivityLogModel } from "src/server/core/activity-log.schema";
import { OrderModel, OrderLineModel } from "src/server/commerce/order.schema";
import { ReturnModel, ReturnLineModel } from "src/server/commerce/return.schema";
import { IdempotencyRecordModel } from "src/server/commerce/idempotency-record.schema";
import { StockMovementModel } from "src/server/catalog/stock-movement.schema";
import { PaymentProofModel } from "src/server/commerce/payment-proof.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Route-level: every admin money- or stock-moving write needs an `Idempotency-Key`, scoped by route + staff actor
 * (CLAUDE.md non-negotiable #8). Proven through the real routes: a replay with the same key returns the ORIGINAL
 * result and does not apply twice (a refund recorded once, stock released once), a different staff member with the
 * same key does not collide, a key reused for a different request is refused, and no key is a 400 that changes nothing.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const putVerify = (await import("./[id]/payment/verify/route")).PUT as RouteHandler;
const putReject = (await import("./[id]/payment/reject/route")).PUT as RouteHandler;
const putRefund = (await import("./[id]/payment/refund/route")).PUT as RouteHandler;
const putStatus = (await import("./[id]/status/route")).PUT as RouteHandler;
const putReceive = (await import("../returns/[id]/receive/route")).PUT as RouteHandler;
const putReturnRefund = (await import("../returns/[id]/refund/route")).PUT as RouteHandler;

const wipe = () =>
  Promise.all([
    OrderModel.deleteMany({}),
    OrderLineModel.deleteMany({}),
    ReturnModel.deleteMany({}),
    ReturnLineModel.deleteMany({}),
    VariantModel.deleteMany({}),
    ProductModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    IdempotencyRecordModel.deleteMany({}),
    StockMovementModel.deleteMany({}),
    PaymentProofModel.deleteMany({}),
  ]);

beforeAll(async () => {
  await connectToDatabase();
});
afterAll(async () => {
  await Promise.all([wipe(), removeHarnessStaff()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await wipe();
});

async function seedOrder(overrides: { status?: "PLACED" | "PROCESSING" | "DELIVERED"; paymentStatus?: "SUBMITTED" | "VERIFIED" | "NOT_REQUIRED"; total?: string } = {}) {
  const total = overrides.total ?? "100.00";
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    status: overrides.status ?? "DELIVERED",
    placedAt: new Date(),
    subtotal: new Decimal(total),
    total: new Decimal(total),
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    payment: { method: "WALLET_TRANSFER", status: overrides.paymentStatus ?? "VERIFIED" },
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
  });
}

async function seedVariant(stock = 5) {
  const category = await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId()}` });
  const product = await ProductModel.create({ slug: `p-${new mongoose.Types.ObjectId()}`, categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });
  return VariantModel.create({ productId: product._id, sku: `SKU-${new mongoose.Types.ObjectId()}`, variantKey: `k-${new mongoose.Types.ObjectId()}`, price: toMoney("10.00"), stock });
}

async function seedOrderLine(orderId: mongoose.Types.ObjectId, variant: { _id: mongoose.Types.ObjectId; sku: string }, quantity = 2) {
  return OrderLineModel.create({ orderId, lineNumber: 1, variantId: variant._id, sku: variant.sku, productName: "T", variantDescription: "D", quantity, unitPrice: toMoney("10.00"), lineTotal: toMoney("20.00") });
}

async function seedReturn(orderId: mongoose.Types.ObjectId, orderLineId: mongoose.Types.ObjectId, status: "APPROVED" | "RECEIVED") {
  const ret = await ReturnModel.create({ orderId, returnNumber: `RET-${new mongoose.Types.ObjectId()}`, reason: "r", status, requestedAt: new Date() });
  const line = await ReturnLineModel.create({ returnId: ret._id, orderLineId, quantity: 2, reason: "r", condition: "Unopened" });
  return { ret, line };
}

let admin: AdminCaller;
const key = () => crypto.randomUUID();
const put = (handler: RouteHandler, path: string, id: string, body: unknown, headers?: Record<string, string>) =>
  admin.call(handler, path, { method: "PUT", body, params: { id }, headers });

describe("an Idempotency-Key is required on every admin money- or stock-moving write", () => {
  it.each([
    ["payment verify", () => putVerify, (id: string) => `/api/admin/orders/${id}/payment/verify`, {}],
    ["payment reject", () => putReject, (id: string) => `/api/admin/orders/${id}/payment/reject`, { reason: "Blurry" }],
    ["payment refund", () => putRefund, (id: string) => `/api/admin/orders/${id}/payment/refund`, { amount: "10.00", reference: "TRX-1" }],
    ["order status transition", () => putStatus, (id: string) => `/api/admin/orders/${id}/status`, { status: "CONFIRMED" }],
    ["return receive", () => putReceive, (id: string) => `/api/admin/returns/${id}/receive`, { lines: [{ returnLineId: new mongoose.Types.ObjectId().toString(), disposition: "DISCARD", inspectedCondition: "x" }] }],
    ["return refund", () => putReturnRefund, (id: string) => `/api/admin/returns/${id}/refund`, { amount: "10.00", refundReference: "TRX-1" }],
  ])("%s without a key is a 400 and changes nothing", async (_label, handler, path, body) => {
    admin = await signInAsOwner();
    const order = await seedOrder({ status: "PLACED", paymentStatus: "SUBMITTED" });
    const id = order._id.toString();

    for (const header of [{ "Idempotency-Key": "" }]) {
      const response = await put(handler(), path(id), id, body, header);
      expect(response.status).toBe(400);
    }

    const after = await OrderModel.findById(order._id).lean();
    expect(after?.status).toBe("PLACED");
    expect(after?.payment.status).toBe("SUBMITTED");
    expect(after?.timeline).toHaveLength(1);
    expect(await IdempotencyRecordModel.countDocuments({})).toBe(0);
  });
});

describe("payment refund", () => {
  beforeEach(async () => {
    admin = await signInAsOwner();
  });

  it.each([
    ["missing", {}],
    ["blank", { reference: "" }],
    ["whitespace only", { reference: "    " }],
    ["over 200 characters", { reference: "x".repeat(201) }],
  ])("refuses a refund whose reference is %s (D-12) with 400, recording nothing", async (_label, extra) => {
    const order = await seedOrder();
    const id = order._id.toString();

    const response = await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, { amount: "10.00", ...extra });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/reference/);
    const after = await OrderModel.findById(order._id).lean();
    expect(after?.payment.status).toBe("VERIFIED");
    expect(after?.payment.refund).toBeUndefined();
    expect(after?.timeline).toHaveLength(1);
  });

  it("trims the reference it stores", async () => {
    const order = await seedOrder();
    const id = order._id.toString();

    const response = await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, { amount: "10.00", reference: "  TRX-77  " });

    expect(response.status).toBe(200);
    expect((await OrderModel.findById(order._id).lean())?.payment.refund?.reference).toBe("TRX-77");
  });

  it("a replay with the same key returns the original result and records the refund ONCE", async () => {
    const order = await seedOrder();
    const id = order._id.toString();
    const headers = { "Idempotency-Key": key() };
    const body = { amount: "30.00", reference: "TRX-1", reason: "Damaged" };

    const first = await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, body, headers);
    const replay = await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, body, headers);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    const after = await OrderModel.findById(order._id).lean();
    expect(after?.refundedTotal.toString()).toBe("30.00");
    expect(after?.timeline.filter((entry) => entry.type === "PAYMENT_REFUNDED")).toHaveLength(1);
  });

  it("a replay writes NO second activity-log entry: one refund, one entry", async () => {
    const order = await seedOrder();
    const id = order._id.toString();
    const headers = { "Idempotency-Key": key() };
    const body = { amount: "30.00", reference: "TRX-1" };

    await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, body, headers);
    await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, body, headers);
    await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, body, headers);

    const entries = await ActivityLogModel.find({ entityId: order._id, action: "refund" }).lean();
    expect(entries).toHaveLength(1);
  });

  it("a first-time request (a fresh key) is still audited — only replays are skipped", async () => {
    const first = await seedOrder();
    const second = await seedOrder();

    await put(putRefund, `/api/admin/orders/${first._id}/payment/refund`, first._id.toString(), { amount: "10.00", reference: "TRX-A" });
    await put(putRefund, `/api/admin/orders/${second._id}/payment/refund`, second._id.toString(), { amount: "10.00", reference: "TRX-B" });

    expect(await ActivityLogModel.countDocuments({ entityId: first._id, action: "refund" })).toBe(1);
    expect(await ActivityLogModel.countDocuments({ entityId: second._id, action: "refund" })).toBe(1);
  });

  it("WITHOUT replay protection the same second call is refused by the state machine — the replay is what returned 200", async () => {
    const order = await seedOrder();
    const id = order._id.toString();
    const body = { amount: "30.00", reference: "TRX-1" };

    await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, body, { "Idempotency-Key": key() });
    const second = await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, body, { "Idempotency-Key": key() });

    expect(second.status).toBe(409);
    expect((await OrderModel.findById(order._id).lean())?.refundedTotal.toString()).toBe("30.00");
  });

  it("the same key for a DIFFERENT request is refused (422) and applies nothing", async () => {
    const order = await seedOrder();
    const id = order._id.toString();
    const headers = { "Idempotency-Key": key() };

    await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, { amount: "30.00", reference: "TRX-1" }, headers);
    const reused = await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, { amount: "50.00", reference: "TRX-2" }, headers);

    expect(reused.status).toBe(422);
    expect((await OrderModel.findById(order._id).lean())?.refundedTotal.toString()).toBe("30.00");
  });

  it("the same key on a DIFFERENT order is refused too — the order is part of the fingerprint, never a silent replay of another order's refund", async () => {
    const [a, b] = [await seedOrder(), await seedOrder()];
    const headers = { "Idempotency-Key": key() };
    const body = { amount: "30.00", reference: "TRX-1" };

    await put(putRefund, `/api/admin/orders/${a._id}/payment/refund`, a._id.toString(), body, headers);
    const onB = await put(putRefund, `/api/admin/orders/${b._id}/payment/refund`, b._id.toString(), body, headers);

    expect(onB.status).toBe(422);
    expect((await OrderModel.findById(b._id).lean())?.payment.status).toBe("VERIFIED");
  });

  it("a failed attempt releases its key, so the genuine retry with the SAME key runs", async () => {
    const order = await seedOrder({ total: "100.00" });
    const id = order._id.toString();
    const headers = { "Idempotency-Key": key() };

    // Over the refundable remainder: refused (409), nothing recorded...
    const tooMuch = await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, { amount: "500.00", reference: "TRX-1" }, headers);
    expect(tooMuch.status).toBe(409);
    expect(await IdempotencyRecordModel.countDocuments({})).toBe(0);

    // ...and the same key is free to carry a corrected request.
    const corrected = await put(putRefund, `/api/admin/orders/${id}/payment/refund`, id, { amount: "100.00", reference: "TRX-1" }, headers);
    expect(corrected.status).toBe(200);
  });

  it("a different staff member presenting the same key does not collide with — or replay — the first one's", async () => {
    const [a, b] = [await seedOrder(), await seedOrder()];
    const headers = { "Idempotency-Key": "shared-client-key" };

    const first = await put(putRefund, `/api/admin/orders/${a._id}/payment/refund`, a._id.toString(), { amount: "30.00", reference: "TRX-A" }, headers);
    expect(first.status).toBe(200);

    admin = await signInAsOwner(); // a second, distinct staff account
    const second = await put(putRefund, `/api/admin/orders/${b._id}/payment/refund`, b._id.toString(), { amount: "30.00", reference: "TRX-B" }, headers);

    expect(second.status).toBe(200);
    expect((await OrderModel.findById(a._id).lean())?.payment.refund?.reference).toBe("TRX-A");
    expect((await OrderModel.findById(b._id).lean())?.payment.refund?.reference).toBe("TRX-B");
    expect(await IdempotencyRecordModel.countDocuments({})).toBe(2);
  });
});

describe("payment verify and reject", () => {
  beforeEach(async () => {
    admin = await signInAsOwner();
  });

  it("verify: a replay with the same key returns 200 with the original result; a fresh key is a 409 (already verified)", async () => {
    const order = await seedOrder({ status: "PLACED", paymentStatus: "SUBMITTED" });
    const id = order._id.toString();
    const headers = { "Idempotency-Key": key() };

    const first = await put(putVerify, `/api/admin/orders/${id}/payment/verify`, id, {}, headers);
    const replay = await put(putVerify, `/api/admin/orders/${id}/payment/verify`, id, {}, headers);
    const freshKey = await put(putVerify, `/api/admin/orders/${id}/payment/verify`, id, {}, { "Idempotency-Key": key() });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(freshKey.status).toBe(409);
    expect((await OrderModel.findById(order._id).lean())?.timeline.filter((entry) => entry.type === "PAYMENT_VERIFIED")).toHaveLength(1);
  });

  it("reject: a replay records one rejection", async () => {
    const order = await seedOrder({ status: "PLACED", paymentStatus: "SUBMITTED" });
    const id = order._id.toString();
    const headers = { "Idempotency-Key": key() };

    await put(putReject, `/api/admin/orders/${id}/payment/reject`, id, { reason: "Blurry" }, headers);
    const replay = await put(putReject, `/api/admin/orders/${id}/payment/reject`, id, { reason: "Blurry" }, headers);

    expect(replay.status).toBe(200);
    expect((await OrderModel.findById(order._id).lean())?.timeline.filter((entry) => entry.type === "PAYMENT_REJECTED")).toHaveLength(1);
  });
});

describe("order status transitions that release stock", () => {
  it("a replayed cancel releases the stock ONCE", async () => {
    admin = await signInAsOwner();
    const variant = await seedVariant(5);
    const order = await seedOrder({ status: "PROCESSING", paymentStatus: "NOT_REQUIRED" });
    await seedOrderLine(order._id, variant, 2);
    const id = order._id.toString();
    const headers = { "Idempotency-Key": key() };
    const body = { status: "CANCELLED", reason: "Customer asked" };

    const first = await put(putStatus, `/api/admin/orders/${id}/status`, id, body, headers);
    const replay = await put(putStatus, `/api/admin/orders/${id}/status`, id, body, headers);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(7); // 5 + 2, once
    expect(await StockMovementModel.countDocuments({ variantId: variant._id })).toBe(1);
    expect((await OrderModel.findById(order._id).lean())?.timeline.filter((entry) => entry.type === "ORDER_CANCELLED")).toHaveLength(1);
  });
});

describe("returns", () => {
  beforeEach(async () => {
    admin = await signInAsOwner();
  });

  it("a replayed receive restocks ONCE and the return becomes RECEIVED", async () => {
    const variant = await seedVariant(5);
    const order = await seedOrder();
    const orderLine = await seedOrderLine(order._id, variant, 2);
    const { ret, line } = await seedReturn(order._id, orderLine._id, "APPROVED");
    const id = ret._id.toString();
    const headers = { "Idempotency-Key": key() };
    const body = { lines: [{ returnLineId: line._id.toString(), disposition: "RESTOCK", inspectedCondition: "Sealed" }] };

    const first = await put(putReceive, `/api/admin/returns/${id}/receive`, id, body, headers);
    const replay = await put(putReceive, `/api/admin/returns/${id}/receive`, id, body, headers);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(7);
    expect((await ReturnModel.findById(ret._id).lean())?.status).toBe("RECEIVED");
    expect((await ReturnLineModel.findById(line._id).lean())?.inspectedCondition).toBe("Sealed");
  });

  it("receive without the inspected condition is a 400 and restocks nothing", async () => {
    const variant = await seedVariant(5);
    const order = await seedOrder();
    const orderLine = await seedOrderLine(order._id, variant, 2);
    const { ret, line } = await seedReturn(order._id, orderLine._id, "APPROVED");
    const id = ret._id.toString();

    const response = await put(putReceive, `/api/admin/returns/${id}/receive`, id, { lines: [{ returnLineId: line._id.toString(), disposition: "RESTOCK" }] });

    expect(response.status).toBe(400);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(5);
    expect((await ReturnModel.findById(ret._id).lean())?.status).toBe("APPROVED");
  });

  it("a replayed return refund records ONE refund", async () => {
    const variant = await seedVariant(5);
    const order = await seedOrder();
    const orderLine = await seedOrderLine(order._id, variant, 2);
    const { ret } = await seedReturn(order._id, orderLine._id, "RECEIVED");
    const id = ret._id.toString();
    const headers = { "Idempotency-Key": key() };
    const body = { amount: "20.00", refundReference: "TRX-9" };

    const first = await put(putReturnRefund, `/api/admin/returns/${id}/refund`, id, body, headers);
    const replay = await put(putReturnRefund, `/api/admin/returns/${id}/refund`, id, body, headers);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect((await OrderModel.findById(order._id).lean())?.refundedTotal.toString()).toBe("20.00");
    expect((await OrderModel.findById(order._id).lean())?.timeline.filter((entry) => entry.type === "REFUND_ISSUED")).toHaveLength(1);
  });
});
