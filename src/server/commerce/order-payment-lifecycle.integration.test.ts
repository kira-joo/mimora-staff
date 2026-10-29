// @vitest-environment node
import { resolveSession, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { assertPaymentTransition, initialPaymentStatus } from "../engines/order-state/order-state-machine";
import { OrderModel } from "./order.schema";
import { appendOrderTimelineEntry } from "./order-timeline";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await OrderModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function seedOrder(paymentMethod: string, paymentStatus: ReturnType<typeof initialPaymentStatus>) {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString()}`,
    guestPhone: "+201000000000",
    idempotencyKey: `k-${new mongoose.Types.ObjectId().toString()}`,
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    subtotal: toMoney("50.00"),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney("50.00"),
    payment: { method: paymentMethod, status: paymentStatus, destinationSnapshot: { accountName: "Store Wallet", handle: "01000000000" } },
    status: "PLACED",
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    placedAt: new Date(),
  });
}

/** Applies a payment-status transition to an Order document plus its timeline, inside one transaction — the shape a future Phase 4B route would call. */
async function transitionPayment(orderId: mongoose.Types.ObjectId, from: string, to: string, opts: { reason?: string; actorId?: mongoose.Types.ObjectId } = {}) {
  assertPaymentTransition(from as never, to as never, opts.reason);
  await withTransaction(async (tx) => {
    await OrderModel.updateOne({ _id: orderId }, { $set: { "payment.status": to } }, { session: resolveSession() });
    const eventByStatus: Record<string, string> = { SUBMITTED: "PAYMENT_SUBMITTED", VERIFIED: "PAYMENT_VERIFIED", REJECTED: "PAYMENT_REJECTED", REFUNDED: "PAYMENT_REFUNDED" };
    const type = eventByStatus[to];
    if (type) {
      await appendOrderTimelineEntry(orderId, { type: type as never, at: new Date(), actorType: opts.actorId ? "STAFF" : "CUSTOMER", actorId: opts.actorId, reason: opts.reason });
    }
    return tx.complete(undefined);
  });
}

describe("Order.payment lifecycle — COD", () => {
  it("starts and stays NOT_REQUIRED with no proof step at all", async () => {
    const order = await seedOrder("COD", initialPaymentStatus(false, false));
    expect(order.payment.status).toBe("NOT_REQUIRED");
  });
});

describe("Order.payment lifecycle — manual transfer (Bank Transfer / Payment Proof)", () => {
  it("full happy path: AWAITING_PAYMENT → SUBMITTED → VERIFIED, each step recorded on the timeline", async () => {
    const order = await seedOrder("WALLET_TRANSFER", initialPaymentStatus(true, false));
    expect(order.payment.status).toBe("AWAITING_PAYMENT");

    await transitionPayment(order._id, "AWAITING_PAYMENT", "SUBMITTED");
    await transitionPayment(order._id, "SUBMITTED", "VERIFIED", { actorId: new mongoose.Types.ObjectId() });

    const updated = await OrderModel.findById(order._id).lean();
    expect(updated?.payment.status).toBe("VERIFIED");
    expect(updated?.timeline.map((e) => e.type)).toEqual(["ORDER_PLACED", "PAYMENT_SUBMITTED", "PAYMENT_VERIFIED"]);
  });

  it("a rejected proof reopens submission — REJECTED is never a dead end", async () => {
    const order = await seedOrder("WALLET_TRANSFER", initialPaymentStatus(true, false));
    await transitionPayment(order._id, "AWAITING_PAYMENT", "SUBMITTED");
    await transitionPayment(order._id, "SUBMITTED", "REJECTED", { reason: "Amount does not match", actorId: new mongoose.Types.ObjectId() });

    let updated = await OrderModel.findById(order._id).lean();
    expect(updated?.payment.status).toBe("REJECTED");
    expect(updated?.timeline.at(-1)?.reason).toBe("Amount does not match");

    // The customer resubmits — REJECTED → SUBMITTED is allowed directly.
    await transitionPayment(order._id, "REJECTED", "SUBMITTED");
    updated = await OrderModel.findById(order._id).lean();
    expect(updated?.payment.status).toBe("SUBMITTED");
  });

  it("rejecting without a reason is refused — the customer needs something to act on", () => {
    expect(() => assertPaymentTransition("SUBMITTED" as never, "REJECTED" as never)).toThrow(/requires a reason/);
  });

  it("refund is reachable only from VERIFIED, and is record-and-audit only (D-12) — no external reversal call anywhere in this path", async () => {
    const order = await seedOrder("WALLET_TRANSFER", initialPaymentStatus(true, false));
    await transitionPayment(order._id, "AWAITING_PAYMENT", "SUBMITTED");
    await transitionPayment(order._id, "SUBMITTED", "VERIFIED");

    const refundReference = "REFUND-REF-001";
    await withTransaction(async (tx) => {
      await OrderModel.updateOne(
        { _id: order._id },
        { $set: { "payment.status": "REFUNDED", "payment.refund": { reason: "Customer requested", reference: refundReference, at: new Date(), amount: toMoney("50.00") } } },
        { session: resolveSession() }
      );
      await appendOrderTimelineEntry(order._id, { type: "PAYMENT_REFUNDED", at: new Date(), actorType: "STAFF", reason: "Customer requested" });
      return tx.complete(undefined);
    });

    const updated = await OrderModel.findById(order._id).lean();
    expect(updated?.payment.status).toBe("REFUNDED");
    expect(updated?.payment.refund?.reference).toBe(refundReference); // declared schema field, not an untyped $set onto an undeclared path
    expect(updated?.payment.refund?.amount?.toString()).toBe("50.00");
  });

  it("cannot skip straight from AWAITING_PAYMENT to VERIFIED — a proof or provider confirmation must land first", () => {
    expect(() => assertPaymentTransition("AWAITING_PAYMENT" as never, "VERIFIED" as never)).toThrow();
  });
});

describe("Order.payment method is configuration-driven, not a fixed enum", () => {
  it("accepts any configured method string, including one that did not exist when this schema was written", async () => {
    // The whole point of Phase 4A.5's redesign: a new PaymentSettings.methods[]
    // entry (e.g. a future "INSTAPAY_TRANSFER" or "ONLINE_CARD") needs no schema change.
    const order = await seedOrder("INSTAPAY_TRANSFER", initialPaymentStatus(true, false));
    expect(order.payment.method).toBe("INSTAPAY_TRANSFER");
  });
});
