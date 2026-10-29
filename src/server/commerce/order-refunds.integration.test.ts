import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { BadRequestError, ConflictError } from "@kira-joo/backend-toolkit-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { OrderModel } from "./order.schema";
import { ReturnModel } from "./return.schema";
import { refundPayment } from "../admin/payments/refund-payment";
import { refundReturn } from "../admin/returns/refund-return";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const staffId = new mongoose.Types.ObjectId().toString();
const m = (value: string) => toMoney(value);

async function seedOrder(total = "100.00") {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    fulfilment: { mode: "PICKUP", fee: m("0.00") },
    subtotal: m(total),
    discount: m("0.00"),
    tax: m("0.00"),
    total: m(total),
    payment: { method: "INSTAPAY", status: "VERIFIED" },
    status: "DELIVERED",
    timeline: [],
    placedAt: new Date(),
  });
}

async function seedApprovedReturn(orderId: mongoose.Types.ObjectId) {
  return ReturnModel.create({ orderId, returnNumber: `RET-${new mongoose.Types.ObjectId()}`, reason: "Wrong size", status: "APPROVED", requestedAt: new Date() });
}

const refundOfReturn = (returnId: mongoose.Types.ObjectId, amount: string) =>
  refundReturn({ returnId: returnId.toString(), refundReference: `TXN-${new mongoose.Types.ObjectId()}`, amount: m(amount), staffId, now: new Date() });

const refundOfPayment = (orderId: mongoose.Types.ObjectId, amount: string) =>
  refundPayment({ orderId: orderId.toString(), amount: m(amount), reference: "TXN", staffId, now: new Date() });

async function refundedTotal(orderId: mongoose.Types.ObjectId) {
  return (await OrderModel.findById(orderId))!.refundedTotal.toFixed(2);
}

describe("order refund invariants", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([OrderModel.deleteMany({}), ReturnModel.deleteMany({})]);
  });

  it("a full payment refund claims the whole refundable total", async () => {
    const order = await seedOrder("100.00");
    await refundOfPayment(order._id, "100.00");
    expect(await refundedTotal(order._id)).toBe("100.00");
  });

  it("a partial return refund claims only its amount", async () => {
    const order = await seedOrder("100.00");
    const ret = await seedApprovedReturn(order._id);
    await refundOfReturn(ret._id, "30.00");
    expect(await refundedTotal(order._id)).toBe("30.00");
  });

  it("multiple partial refunds accumulate, across both refund kinds", async () => {
    const order = await seedOrder("100.00");
    await refundOfReturn((await seedApprovedReturn(order._id))._id, "30.00");
    await refundOfReturn((await seedApprovedReturn(order._id))._id, "20.00");
    await refundOfPayment(order._id, "50.00");
    expect(await refundedTotal(order._id)).toBe("100.00");
  });

  it("rejects a single refund larger than the order", async () => {
    const order = await seedOrder("100.00");
    await expect(refundOfPayment(order._id, "100.01")).rejects.toThrow(ConflictError);
    expect(await refundedTotal(order._id)).toBe("0.00");
  });

  it("rejects the refund that would push the cumulative total past the order, and records nothing for it", async () => {
    const order = await seedOrder("100.00");
    await refundOfReturn((await seedApprovedReturn(order._id))._id, "80.00");
    const second = await seedApprovedReturn(order._id);

    await expect(refundOfReturn(second._id, "25.00")).rejects.toThrow(ConflictError);
    // The whole transaction rolled back: the return was not marked refunded, and the counter did not move.
    expect((await ReturnModel.findById(second._id))!.status).toBe("APPROVED");
    expect(await refundedTotal(order._id)).toBe("80.00");

    await expect(refundOfPayment(order._id, "20.01")).rejects.toThrow(ConflictError);
    expect((await OrderModel.findById(order._id))!.payment.status).toBe("VERIFIED");
  });

  it("rejects a zero amount", async () => {
    const order = await seedOrder("100.00");
    await expect(refundOfPayment(order._id, "0.00")).rejects.toThrow(BadRequestError);
  });

  it("one refund operation is counted once: refunding the same return twice fails and claims nothing more", async () => {
    const order = await seedOrder("100.00");
    const ret = await seedApprovedReturn(order._id);
    await refundOfReturn(ret._id, "40.00");
    await expect(refundOfReturn(ret._id, "40.00")).rejects.toThrow(ConflictError);
    expect(await refundedTotal(order._id)).toBe("40.00");
  });

  it("a payment can be refunded only once", async () => {
    const order = await seedOrder("100.00");
    await refundOfPayment(order._id, "10.00");
    await expect(refundOfPayment(order._id, "10.00")).rejects.toThrow(ConflictError);
    expect(await refundedTotal(order._id)).toBe("10.00");
  });

  it("concurrent refunds can never jointly exceed the order", async () => {
    const order = await seedOrder("100.00");
    const returns = await Promise.all(Array.from({ length: 4 }, () => seedApprovedReturn(order._id)));

    const outcomes = await Promise.allSettled(returns.map((ret) => refundOfReturn(ret._id, "40.00")));

    const succeeded = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
    expect(succeeded).toBe(2); // 2 × 40 fits in 100; a third would not
    expect(await refundedTotal(order._id)).toBe("80.00");
    expect(await ReturnModel.countDocuments({ status: "REFUNDED" })).toBe(2);
  });
});
