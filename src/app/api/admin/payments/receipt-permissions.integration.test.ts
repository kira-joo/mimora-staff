import mongoose from "mongoose";
import { Decimal } from "decimal.js";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { OrderModel } from "src/server/commerce/order.schema";
import { PaymentProofModel } from "src/server/commerce/payment-proof.schema";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInWithPermissions, type RouteHandler } from "../test-support/admin-route-harness";

/*
 * The negative cases for receipts (2026-10-22): seeing a customer's receipt (bank data), verifying it,
 * and rejecting it each need their own permission, and a staff member without it is refused (403)
 * with the order and proof untouched. The route sweep proves each route DECLARES permissions; this
 * proves they are ENFORCED. Storage is stubbed only to mint a link — the authorization under test
 * runs before it.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});
vi.mock("src/server/core/assets/asset-providers", () => ({ privateAssets: () => ({ signedUrl: () => "https://signed.example/receipt" }) }));

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const getQueue = (await import("./queue/route")).GET as RouteHandler;
const putVerify = (await import("../orders/[id]/payment/verify/route")).PUT as RouteHandler;
const putReject = (await import("../orders/[id]/payment/reject/route")).PUT as RouteHandler;

let orderId: string;

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  await Promise.all([OrderModel.deleteMany({}), PaymentProofModel.deleteMany({}), removeHarnessStaff()]);
  const order = await OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    status: "PLACED",
    placedAt: new Date(),
    subtotal: new Decimal("10.00"),
    total: new Decimal("10.00"),
    fulfilment: { mode: "DELIVERY", fee: toMoney("0.00") },
    payment: { method: "BANK_TRANSFER", status: "SUBMITTED" },
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
  });
  orderId = order._id.toString();
  await PaymentProofModel.create({ orderId: order._id, submittedAt: new Date(), asset: { publicId: "payment-proofs/x", format: "jpg", bytes: 100, mimeType: "image/jpeg", filename: "x.jpg" }, status: "SUBMITTED" });
});
afterAll(async () => {
  await removeHarnessStaff();
  await mongoose.disconnect();
});

const untouched = async () => {
  const order = await OrderModel.findById(orderId).lean();
  const proof = await PaymentProofModel.findOne({ orderId }).lean();
  expect(order?.payment.status).toBe("SUBMITTED");
  expect(proof?.status).toBe("SUBMITTED");
};

describe("receipt permissions — the negative cases", () => {
  it.each([
    ["order-read only", [AppPermission.ORDER.READ]],
    ["the default Fulfilment role", [AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE, CustomPermission.ORDER_TRANSITION]],
    ["the default Support role (incl. refunds)", [AppPermission.ORDER.READ, AppPermission.ORDER.READ_ONE, CustomPermission.PAYMENT_REFUND]],
    ["reject-only", [CustomPermission.PAYMENT_REJECT]],
  ])("receipts and their signed links need Payment.verify: %s is refused (403) and no link is minted", async (_label, keys) => {
    const staff = await signInWithPermissions(keys);
    const response = await staff.call(getQueue, "/api/admin/payments/queue");
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain("signed.example");
  });

  it("…and Payment.verify sees the queue with the signed receipt link", async () => {
    const verifier = await signInWithPermissions([CustomPermission.PAYMENT_VERIFY]);
    const response = await verifier.call(getQueue, "/api/admin/payments/queue");
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].proof.signedUrl).toBe("https://signed.example/receipt");
  });

  it("no staff session at all: 401", async () => {
    const { NextRequest } = await import("next/server");
    const { harnessCookieJar } = await import("../test-support/admin-route-harness");
    harnessCookieJar.clear();
    const response = await getQueue(new NextRequest("http://localhost/api/admin/payments/queue"), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
  });

  it("only Payment.verify can verify: a reader and a rejecter are refused, nothing changes", async () => {
    for (const keys of [[AppPermission.ORDER.READ], [AppPermission.ORDER.READ, CustomPermission.PAYMENT_REJECT]]) {
      const staff = await signInWithPermissions(keys);
      const response = await staff.call(putVerify, `/api/admin/orders/${orderId}/payment/verify`, { method: "PUT", body: {}, params: { id: orderId } });
      expect(response.status).toBe(403);
      await untouched();
    }
  });

  it("only Payment.reject can reject: a reader and a verifier are refused, nothing changes", async () => {
    for (const keys of [[AppPermission.ORDER.READ], [AppPermission.ORDER.READ, CustomPermission.PAYMENT_VERIFY]]) {
      const staff = await signInWithPermissions(keys);
      const response = await staff.call(putReject, `/api/admin/orders/${orderId}/payment/reject`, { method: "PUT", body: { reason: "Blurry" }, params: { id: orderId } });
      expect(response.status).toBe(403);
      await untouched();
    }
  });

  it("the positive control: Payment.verify verifies", async () => {
    const verifier = await signInWithPermissions([AppPermission.ORDER.READ, CustomPermission.PAYMENT_VERIFY]);
    const response = await verifier.call(putVerify, `/api/admin/orders/${orderId}/payment/verify`, { method: "PUT", body: {}, params: { id: orderId } });
    expect(response.status).toBe(200);
    expect((await OrderModel.findById(orderId).lean())?.payment.status).toBe("VERIFIED");
  });
});
