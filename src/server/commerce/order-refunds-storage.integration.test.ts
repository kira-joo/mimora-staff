import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { OrderModel } from "./order.schema";
import { ReturnModel } from "./return.schema";
import { refundPayment } from "../admin/payments/refund-payment";
import { refundReturn } from "../admin/returns/refund-return";

/**
 * The refund guard over BSON Double storage, and over orders still holding Decimal128 from before the change. A
 * sum of doubles is not exact (0.10 + 0.20 = 0.30000000000000004), so these are the cases a naive `$add`/`$inc` on
 * doubles gets wrong: a legitimate full refund refused, a float tail stored, a cap that drifts.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const staffId = new mongoose.Types.ObjectId().toString();
const m = (value: string) => toMoney(value);
const raw = () => OrderModel.collection;

async function seedOrder(total: string) {
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

/** Rewrites an order's amounts as Decimal128, exactly as a record written before the storage change holds them. */
async function makeLegacy(orderId: mongoose.Types.ObjectId, amounts: Record<string, string>) {
  await raw().updateOne({ _id: orderId }, { $set: Object.fromEntries(Object.entries(amounts).map(([field, value]) => [field, mongoose.Types.Decimal128.fromString(value)])) });
}

const seedApprovedReturn = (orderId: mongoose.Types.ObjectId) =>
  ReturnModel.create({ orderId, returnNumber: `RET-${new mongoose.Types.ObjectId()}`, reason: "Wrong size", status: "APPROVED", requestedAt: new Date() });

const refundOfReturn = (returnId: mongoose.Types.ObjectId, amount: string) =>
  refundReturn({ returnId: returnId.toString(), refundReference: `TXN-${new mongoose.Types.ObjectId()}`, amount: m(amount), staffId, now: new Date() });

/** The stored BSON type and exact value of `refundedTotal`, read without any Mongoose casting. */
async function storedRefundedTotal(orderId: mongoose.Types.ObjectId) {
  const [row] = await raw().aggregate([{ $match: { _id: orderId } }, { $project: { type: { $type: "$refundedTotal" }, value: "$refundedTotal" } }]).toArray();
  return { type: row!.type as string, value: String(row!.value) };
}

describe("refunds over Double storage", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
  beforeEach(async () => {
    await Promise.all([OrderModel.deleteMany({}), ReturnModel.deleteMany({})]);
  });

  it("stores the order's amounts as BSON Double", async () => {
    const order = await seedOrder("0.30");
    const [row] = await raw().aggregate([{ $match: { _id: order._id } }, { $project: { _id: 0, total: { $type: "$total" }, refundedTotal: { $type: "$refundedTotal" }, fee: { $type: "$fulfilment.fee" } } }]).toArray();
    expect(row).toEqual({ total: "double", refundedTotal: "double", fee: "double" });
  });

  it("0.10 then 0.20 refunds a 0.30 order in full — exact, not 0.30000000000000004 — and nothing more fits", async () => {
    const order = await seedOrder("0.30");
    await refundOfReturn((await seedApprovedReturn(order._id))._id, "0.10");
    await refundOfReturn((await seedApprovedReturn(order._id))._id, "0.20");
    expect(await storedRefundedTotal(order._id)).toEqual({ type: "double", value: "0.3" });
    await expect(refundOfReturn((await seedApprovedReturn(order._id))._id, "0.01")).rejects.toBeInstanceOf(ConflictError);
    expect(await storedRefundedTotal(order._id)).toEqual({ type: "double", value: "0.3" });
  });

  it("many small refunds accumulate with no float drift (100 × 0.01 = 1.00 exactly)", async () => {
    const order = await seedOrder("1.00");
    for (let i = 0; i < 100; i += 1) await refundOfReturn((await seedApprovedReturn(order._id))._id, "0.01");
    expect(await storedRefundedTotal(order._id)).toEqual({ type: "double", value: "1" });
    await expect(refundOfReturn((await seedApprovedReturn(order._id))._id, "0.01")).rejects.toBeInstanceOf(ConflictError);
  }, 60_000);

  it("works on an order still holding Decimal128 from before the change, and writes the new total as Double", async () => {
    const order = await seedOrder("100.00");
    await makeLegacy(order._id, { total: "100.00", refundedTotal: "40.00" });
    await expect(refundOfReturn((await seedApprovedReturn(order._id))._id, "60.01")).rejects.toBeInstanceOf(ConflictError);
    await refundOfReturn((await seedApprovedReturn(order._id))._id, "60.00");
    expect(await storedRefundedTotal(order._id)).toEqual({ type: "double", value: "100" });
  });

  it("a legacy order with no refundedTotal at all starts from zero", async () => {
    const order = await seedOrder("50.00");
    await raw().updateOne({ _id: order._id }, { $unset: { refundedTotal: "" }, $set: { total: mongoose.Types.Decimal128.fromString("50.00") } });
    await refundPayment({ orderId: order._id.toString(), amount: m("50.00"), reference: "TXN", staffId, now: new Date() });
    expect(await storedRefundedTotal(order._id)).toEqual({ type: "double", value: "50" });
  });

  it("concurrent refunds can never jointly exceed the order, on Double data", async () => {
    const order = await seedOrder("0.30");
    const returns = await Promise.all(Array.from({ length: 5 }, () => seedApprovedReturn(order._id)));
    const outcomes = await Promise.allSettled(returns.map((ret) => refundOfReturn(ret._id, "0.10")));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(3);
    expect(await storedRefundedTotal(order._id)).toEqual({ type: "double", value: "0.3" });
    expect(await ReturnModel.countDocuments({ status: "REFUNDED" })).toBe(3);
  });

  it("concurrent refunds can never jointly exceed a legacy Decimal128 order either", async () => {
    const order = await seedOrder("100.00");
    await makeLegacy(order._id, { total: "100.00", refundedTotal: "0.00" });
    const returns = await Promise.all(Array.from({ length: 4 }, () => seedApprovedReturn(order._id)));
    const outcomes = await Promise.allSettled(returns.map((ret) => refundOfReturn(ret._id, "40.00")));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
    expect(await storedRefundedTotal(order._id)).toEqual({ type: "double", value: "80" });
  });

  it("the return's own refund amount is stored as Double too", async () => {
    const order = await seedOrder("10.00");
    const ret = await seedApprovedReturn(order._id);
    await refundOfReturn(ret._id, "2.50");
    const [row] = await ReturnModel.collection.aggregate([{ $match: { _id: ret._id } }, { $project: { _id: 0, type: { $type: "$refundAmount" } } }]).toArray();
    expect(row).toEqual({ type: "double" });
  });
});
