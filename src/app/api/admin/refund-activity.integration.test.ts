import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { ActivityLogModel } from "src/server/core/activity-log.schema";
import { OrderModel } from "src/server/commerce/order.schema";
import { ReturnModel } from "src/server/commerce/return.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "./test-support/admin-route-harness";

/**
 * Route-level: both refund routes are guarded by `Payment.refund`, and their
 * audit entries used to be identical — `Payment.refund` with an `:id` that
 * was an order on one route and a return on the other. Now a payment refund
 * is `Payment.refund` on its order, and a return refund is `Return.refund`
 * on its return, so every entry links to the record it is about.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("./test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const refundPayment = (await import("./orders/[id]/payment/refund/route")).PUT as RouteHandler;
const refundReturn = (await import("./returns/[id]/refund/route")).PUT as RouteHandler;

let admin: AdminCaller;

async function seedOrder() {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    subtotal: toMoney("100.00"),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney("100.00"),
    payment: { method: "INSTAPAY", status: "VERIFIED" },
    status: "DELIVERED",
    timeline: [],
    placedAt: new Date(),
  });
}

async function put(handler: RouteHandler, path: string, id: string, body: unknown) {
  const response = await admin.call(handler, path, { method: "PUT", body, params: { id } });
  expect(response.status).toBe(200);
}

const entries = () => ActivityLogModel.find({ action: "refund" }).lean();

beforeAll(async () => {
  await connectToDatabase();
  admin = await signInAsOwner();
});

afterAll(async () => {
  await Promise.all([removeHarnessStaff(), OrderModel.deleteMany({}), ReturnModel.deleteMany({}), ActivityLogModel.deleteMany({})]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), ReturnModel.deleteMany({}), ActivityLogModel.deleteMany({})]);
});

describe("refund activity entries name the record they are about", () => {
  it("a payment refund is Payment.refund on its order", async () => {
    const order = await seedOrder();
    await put(refundPayment, `/api/admin/orders/${order._id}/payment/refund`, order._id.toString(), { amount: "30.00", reference: "TRX-1" });

    const [entry] = await entries();
    expect(entry).toMatchObject({ entityType: "Payment", action: "refund" });
    expect(entry?.entityId?.toString()).toBe(order._id.toString());
  });

  it("a return refund is Return.refund on its return — not on an id that could be mistaken for an order", async () => {
    const order = await seedOrder();
    const ret = await ReturnModel.create({ orderId: order._id, returnNumber: `RET-${new mongoose.Types.ObjectId()}`, reason: "Wrong size", status: "APPROVED", requestedAt: new Date() });
    await put(refundReturn, `/api/admin/returns/${ret._id}/refund`, ret._id.toString(), { amount: "40.00", refundReference: "TRX-2" });

    const [entry] = await entries();
    expect(entry).toMatchObject({ entityType: "Return", action: "refund" });
    expect(entry?.entityId?.toString()).toBe(ret._id.toString());
    expect(entry?.changes).toMatchObject({ amount: "40.00", refundReference: "TRX-2" });
  });

  it("the two are distinguishable in one log", async () => {
    const order = await seedOrder();
    const ret = await ReturnModel.create({ orderId: order._id, returnNumber: `RET-${new mongoose.Types.ObjectId()}`, reason: "Wrong size", status: "APPROVED", requestedAt: new Date() });
    await put(refundReturn, `/api/admin/returns/${ret._id}/refund`, ret._id.toString(), { amount: "40.00", refundReference: "TRX-2" });
    await put(refundPayment, `/api/admin/orders/${order._id}/payment/refund`, order._id.toString(), { amount: "30.00", reference: "TRX-1" });

    const byType = Object.fromEntries((await entries()).map((entry) => [entry.entityType, entry.entityId?.toString()]));
    expect(byType).toEqual({ Payment: order._id.toString(), Return: ret._id.toString() });
  });
});
