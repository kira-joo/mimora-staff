import mongoose from "mongoose";
import { Decimal } from "decimal.js";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { OrderModel } from "src/server/commerce/order.schema";
import { PaymentSettingsModel } from "src/server/fulfilment/payment-settings.schema";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInWithPermissions, type RouteHandler } from "../test-support/admin-route-harness";

/** The console's manual trigger for the unpaid-order sweep: Order.transition, and the negative case — without it, 403 and nothing swept. */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const post = (await import("./expire-unpaid/route")).POST as RouteHandler;
let orderId: string;

beforeAll(async () => {
  await connectToDatabase();
});
afterAll(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentSettingsModel.deleteMany({}), removeHarnessStaff()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentSettingsModel.deleteMany({}), removeHarnessStaff()]);
  await PaymentSettingsModel.create({ methods: [{ method: "WALLET_TRANSFER", enabled: true, order: 0, requiresProof: true, autoCancelMinutes: 60 }] });
  const order = await OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    status: "PLACED",
    placedAt: new Date(Date.now() - 3 * 60 * 60_000),
    subtotal: new Decimal("10.00"),
    total: new Decimal("10.00"),
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    payment: { method: "WALLET_TRANSFER", status: "AWAITING_PAYMENT" },
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
  });
  orderId = order._id.toString();
});

describe("POST /api/admin/orders/expire-unpaid", () => {
  it("Order.transition runs the sweep", async () => {
    const staff = await signInWithPermissions([CustomPermission.ORDER_TRANSITION]);

    const response = await staff.call(post, "/api/admin/orders/expire-unpaid", { method: "POST" });

    expect(response.status).toBe(200);
    expect((await response.json()).cancelled).toHaveLength(1);
    expect((await OrderModel.findById(orderId).lean())?.status).toBe("CANCELLED");
  });

  it.each([
    ["order-read only", [AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE]],
    ["payment staff", [CustomPermission.PAYMENT_VERIFY, CustomPermission.PAYMENT_REJECT, CustomPermission.PAYMENT_REFUND]],
  ])("NEGATIVE: %s is refused (403) and nothing is cancelled", async (_label, keys) => {
    const staff = await signInWithPermissions(keys);

    const response = await staff.call(post, "/api/admin/orders/expire-unpaid", { method: "POST" });

    expect(response.status).toBe(403);
    expect((await OrderModel.findById(orderId).lean())?.status).toBe("PLACED");
  });
});
