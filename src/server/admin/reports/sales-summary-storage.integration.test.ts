import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { OrderModel } from "../../commerce/order.schema";
import { ReturnModel } from "../../commerce/return.schema";
import { getSalesSummary } from "./get-sales-summary";

/**
 * The sales report's sums over BSON Double storage, over records still holding Decimal128, and over a mix. A plain
 * `$sum` of doubles drifts (thirty 0.10 orders sum to 3.0000000000000004), so the report sums in decimal; these
 * cases fail if it ever stops doing so.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STORE_TIMEZONE = "Africa/Cairo";

const now = new Date("2026-10-02T18:00:00+03:00");
const day = new Date("2026-10-01T12:00:00+03:00");
const d128 = (value: string) => mongoose.Types.Decimal128.fromString(value);

async function seedOrder(total: string, storage: "double" | "decimal128" = "double", extra: Record<string, unknown> = {}) {
  const order = await OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId()}`,
    guestPhone: "+201000000000",
    guestName: "Test Guest",
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    subtotal: toMoney(total),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney(total),
    payment: { method: "COD", status: "NOT_REQUIRED" },
    status: "DELIVERED",
    timeline: [{ type: "ORDER_PLACED", at: day, actorType: "CUSTOMER" }],
    placedAt: day,
    ...extra,
  });
  if (storage === "decimal128") await OrderModel.collection.updateOne({ _id: order._id }, { $set: { total: d128(toMoney(total).toFixed(2)), subtotal: d128(toMoney(total).toFixed(2)) } });
  return order;
}

describe("sales report sums over Double and Decimal128 storage", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
  beforeEach(async () => {
    await Promise.all([OrderModel.deleteMany({}), ReturnModel.deleteMany({})]);
  });

  it("thirty 0.10 orders stored as Double sum to exactly 3.00", async () => {
    for (let i = 0; i < 30; i += 1) await seedOrder("0.10");
    const summary = await getSalesSummary({ granularity: "day", from: "2026-10-01", to: "2026-10-01", now });
    expect(summary.totals.grossSales.toString()).toBe("3");
    expect(summary.totals.revenue.toFixed(2)).toBe("3.00");
    expect(summary.periods[0]!.averageOrderValue.toFixed(2)).toBe("0.10");
  });

  it("sums a mix of Double and Decimal128 orders exactly", async () => {
    await seedOrder("0.10", "double");
    await seedOrder("0.20", "decimal128");
    await seedOrder("19.99", "double");
    await seedOrder("1000.01", "decimal128");
    const summary = await getSalesSummary({ granularity: "day", from: "2026-10-01", to: "2026-10-01", now });
    expect(summary.totals.orderCount).toBe(4);
    expect(summary.totals.grossSales.toFixed(2)).toBe("1020.30");
    expect(summary.totals.revenue.toFixed(2)).toBe("1020.30");
  });

  it("subtracts payment refunds and return refunds stored either way, exactly", async () => {
    const refundedAt = new Date("2026-10-01T15:00:00+03:00");
    const paid = await seedOrder("100.00", "double", { payment: { method: "INSTAPAY", status: "REFUNDED", refund: { amount: toMoney("0.10"), at: refundedAt, reference: "R1" } } });
    const legacy = await seedOrder("50.00", "decimal128", { payment: { method: "INSTAPAY", status: "REFUNDED", refund: { amount: toMoney("0.20"), at: refundedAt, reference: "R2" } } });
    await OrderModel.collection.updateOne({ _id: legacy._id }, { $set: { "payment.refund.amount": d128("0.20") } });
    const ret = await ReturnModel.create({ orderId: paid._id, returnNumber: `RET-${new mongoose.Types.ObjectId()}`, reason: "Size", status: "REFUNDED", refundAmount: toMoney("0.30"), requestedAt: refundedAt, processedAt: refundedAt });
    await ReturnModel.collection.updateOne({ _id: ret._id }, { $set: { refundAmount: d128("0.30") } });
    await ReturnModel.create({ orderId: legacy._id, returnNumber: `RET-${new mongoose.Types.ObjectId()}`, reason: "Size", status: "REFUNDED", refundAmount: toMoney("0.40"), requestedAt: refundedAt, processedAt: refundedAt });

    const summary = await getSalesSummary({ granularity: "day", from: "2026-10-01", to: "2026-10-01", now });
    expect(summary.totals.grossSales.toFixed(2)).toBe("150.00");
    expect(summary.totals.refunds.toFixed(2)).toBe("1.00"); // 0.10 + 0.20 + 0.30 + 0.40, with no float tail
    expect(summary.totals.revenue.toFixed(2)).toBe("149.00");
  });

  it("puts the same decimal strings on the wire whichever way the orders are stored", async () => {
    await seedOrder("12.50", "double");
    const doubleWire = JSON.stringify(await getSalesSummary({ granularity: "day", from: "2026-10-01", to: "2026-10-01", now }));
    await OrderModel.deleteMany({});
    await seedOrder("12.50", "decimal128");
    const decimalWire = JSON.stringify(await getSalesSummary({ granularity: "day", from: "2026-10-01", to: "2026-10-01", now }));
    expect(doubleWire).toBe(decimalWire);
    expect(doubleWire).toContain('"revenue":"12.5"');
    expect(doubleWire).not.toContain("$numberDecimal");
  });
});
