import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { OrderModel } from "../../commerce/order.schema";
import { PaymentProofModel } from "../../commerce/payment-proof.schema";
import { InventorySettingsModel } from "../../fulfilment/inventory-settings.schema";
import { getSalesSummary } from "./get-sales-summary";
import { getStockHealth } from "./get-stock-health";
import { getPaymentAgeing } from "./get-payment-ageing";
import { ReturnModel } from "../../commerce/return.schema";
import { refundPayment } from "../payments/refund-payment";
import { refundReturn } from "../returns/refund-return";
import { ConflictError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
// Fixtures below are written as explicit Cairo instants (+03:00 in this season), so the
// grouping assertions hold whatever the machine's own zone is.
process.env.STORE_TIMEZONE = "Africa/Cairo";

const HOUR_MS = 60 * 60 * 1000;

async function seedOrder(options: {
  placedAt: Date;
  total: string;
  status?: "PLACED" | "IN_TRANSIT" | "DELIVERED" | "COLLECTED" | "CANCELLED";
  paymentStatus?: "NOT_REQUIRED" | "SUBMITTED";
}) {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString()}`,
    guestPhone: "+201000000000",
    guestName: "Test Guest",
    idempotencyKey: `k-${new mongoose.Types.ObjectId().toString()}`,
    fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
    subtotal: toMoney(options.total),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney(options.total),
    payment: { method: options.paymentStatus === "SUBMITTED" ? "INSTAPAY" : "COD", status: options.paymentStatus ?? "NOT_REQUIRED" },
    status: options.status ?? "PLACED",
    timeline: [{ type: "ORDER_PLACED", at: options.placedAt, actorType: "CUSTOMER" }],
    placedAt: options.placedAt,
  });
}

async function seedVariant(options: { stock: number; lowStockThreshold?: number; discontinued?: boolean }) {
  const category = await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId().toString()}` });
  const product = await ProductModel.create({
    slug: `product-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "Shirt", ar: "قميص" },
  });
  return VariantModel.create({
    productId: product._id,
    sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
    variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    price: toMoney("10.00"),
    stock: options.stock,
    lowStockThreshold: options.lowStockThreshold,
    discontinued: options.discontinued ?? false,
  });
}

describe("Admin Reports", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      OrderModel.deleteMany({}),
      PaymentProofModel.deleteMany({}),
      VariantModel.deleteMany({}),
      ProductModel.deleteMany({}),
      CategoryModel.deleteMany({}),
      InventorySettingsModel.deleteMany({}),
      ReturnModel.deleteMany({}),
    ]);
  });

  describe("getSalesSummary", () => {
    const now = new Date("2026-10-02T18:00:00+03:00");

    it("buckets by local day, excludes cancelled orders, and sums revenue exactly", async () => {
      await seedOrder({ placedAt: new Date("2026-10-01T00:05:00+03:00"), total: "0.10" }); // just after local midnight
      await seedOrder({ placedAt: new Date("2026-10-01T23:55:00+03:00"), total: "0.20" }); // just before the next
      await seedOrder({ placedAt: new Date("2026-10-01T12:00:00+03:00"), total: "999.00", status: "CANCELLED" });
      await seedOrder({ placedAt: new Date("2026-10-02T09:00:00+03:00"), total: "50.00", status: "DELIVERED" });

      const summary = await getSalesSummary({ granularity: "day", from: "2026-09-30", to: "2026-10-02", now });

      expect(summary.periods.map((p) => [p.period, p.orderCount, p.revenue.toFixed(2)])).toEqual([
        ["2026-09-30", 0, "0.00"],
        ["2026-10-01", 2, "0.30"],
        ["2026-10-02", 1, "50.00"],
      ]);
      expect(summary.periods[1].averageOrderValue.toFixed(2)).toBe("0.15");
      expect(summary.totals.orderCount).toBe(3);
      expect(summary.totals.revenue.toFixed(2)).toBe("50.30");
    });

    it("counts every non-cancelled status alike — a COLLECTED pickup and an IN_TRANSIT delivery are sales exactly as a DELIVERED one is", async () => {
      const placedAt = new Date("2026-10-02T09:00:00+03:00");
      for (const status of ["DELIVERED", "COLLECTED", "IN_TRANSIT"] as const) await seedOrder({ placedAt, total: "10.00", status });
      await seedOrder({ placedAt, total: "10.00", status: "CANCELLED" });

      const summary = await getSalesSummary({ granularity: "day", from: "2026-10-02", to: "2026-10-02", now });

      expect(summary.totals.orderCount).toBe(3);
      expect(summary.totals.revenue.toFixed(2)).toBe("30.00");
    });

    it("leaves out orders outside the range on both ends", async () => {
      await seedOrder({ placedAt: new Date("2026-09-30T23:59:00+03:00"), total: "10.00" });
      await seedOrder({ placedAt: new Date("2026-10-02T00:00:00+03:00"), total: "10.00" });
      await seedOrder({ placedAt: new Date("2026-10-01T12:00:00+03:00"), total: "7.00" });

      const summary = await getSalesSummary({ granularity: "day", from: "2026-10-01", to: "2026-10-01", now });
      expect(summary.totals.orderCount).toBe(1);
      expect(summary.totals.revenue.toFixed(2)).toBe("7.00");
    });

    it("groups by month", async () => {
      await seedOrder({ placedAt: new Date("2026-08-31T23:00:00+03:00"), total: "5.00" });
      await seedOrder({ placedAt: new Date("2026-09-01T01:00:00+03:00"), total: "15.00" });
      await seedOrder({ placedAt: new Date("2026-09-20T01:00:00+03:00"), total: "25.00" });

      const summary = await getSalesSummary({ granularity: "month", from: "2026-08-01", to: "2026-09-30", now });
      expect(summary.periods.map((p) => [p.period, p.orderCount, p.revenue.toFixed(2)])).toEqual([
        ["2026-08", 1, "5.00"],
        ["2026-09", 2, "40.00"],
      ]);
    });

    it("serializes Money as plain decimals, never BSON extended JSON", async () => {
      await seedOrder({ placedAt: new Date("2026-10-01T12:00:00+03:00"), total: "12.50" });
      const summary = await getSalesSummary({ granularity: "day", from: "2026-10-01", to: "2026-10-01", now });
      const wire = JSON.stringify(summary);
      expect(wire).not.toContain("$numberDecimal");
      expect(wire).toContain('"revenue":"12.5"');
    });

    it("groups by STORE_TIMEZONE: the same orders fall on different days in another zone", async () => {
      // 00:30 on 1 Oct in Cairo is still 30 Sep in New York (21:30 UTC on 30 Sep, 17:30 EDT).
      await seedOrder({ placedAt: new Date("2026-10-01T00:30:00+03:00"), total: "5.00" });

      const cairo = await getSalesSummary({ granularity: "day", from: "2026-09-30", to: "2026-10-01", now });
      expect(cairo.periods.map((p) => p.orderCount)).toEqual([0, 1]);

      process.env.STORE_TIMEZONE = "America/New_York";
      try {
        const newYork = await getSalesSummary({ granularity: "day", from: "2026-09-30", to: "2026-10-01", now });
        expect(newYork.periods.map((p) => p.orderCount)).toEqual([1, 0]);
      } finally {
        process.env.STORE_TIMEZONE = "Africa/Cairo";
      }
    });

    it("refuses to run without a valid STORE_TIMEZONE rather than assume one", async () => {
      for (const value of [undefined, "Not/AZone"]) {
        if (value === undefined) delete process.env.STORE_TIMEZONE;
        else process.env.STORE_TIMEZONE = value;
        try {
          await expect(getSalesSummary({ granularity: "day", now })).rejects.toThrow(/STORE_TIMEZONE/);
        } finally {
          process.env.STORE_TIMEZONE = "Africa/Cairo";
        }
      }
    });

    it("is served by the Order.placedAt index — the range scan is an IXSCAN, not a collection scan", async () => {
      const indexes = await OrderModel.listIndexes();
      expect(indexes.some((index) => JSON.stringify(index.key) === JSON.stringify({ placedAt: 1 }))).toBe(true);

      const plan = await OrderModel.aggregate([
        { $match: { placedAt: { $gte: new Date("2026-10-01T00:00:00+03:00"), $lt: new Date("2026-10-02T00:00:00+03:00") }, status: { $ne: "CANCELLED" } } },
        { $group: { _id: null, orderCount: { $sum: 1 } } },
      ]).explain("queryPlanner");
      const winning = JSON.stringify(plan);
      expect(winning).toContain("IXSCAN");
      expect(winning).toContain("placedAt_1");
      expect(winning).not.toContain("COLLSCAN");
    });

    it("maps an invalid range to a 400", async () => {
      await expect(getSalesSummary({ granularity: "day", from: "2026-10-02", to: "2026-10-01", now })).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe("getSalesSummary — revenue is sales minus refunds, each on its own date", () => {
    const now = new Date("2026-11-15T12:00:00+02:00");
    const staffId = new mongoose.Types.ObjectId().toString();
    const at = (iso: string) => new Date(iso);

    const payRefund = (orderId: mongoose.Types.ObjectId, amount: string, when: Date) =>
      refundPayment({ orderId: orderId.toString(), amount: toMoney(amount), reference: "TXN-REPORTS", staffId, now: when });

    const returnRefund = async (orderId: mongoose.Types.ObjectId, amount: string, when: Date) => {
      const ret = await ReturnModel.create({ orderId, returnNumber: `RET-${new mongoose.Types.ObjectId()}`, reason: "x", status: "APPROVED", requestedAt: when });
      return refundReturn({ returnId: ret._id.toString(), refundReference: `TXN-${ret._id}`, amount: toMoney(amount), staffId, now: when });
    };

    const daily = (from: string, to: string) => getSalesSummary({ granularity: "day", from, to, now });
    const revenue = (summary: Awaited<ReturnType<typeof getSalesSummary>>) => summary.periods.map((p) => [p.period, p.revenue.toFixed(2)]);

    it("an order with no refunds: revenue is its total", async () => {
      await seedOrder({ placedAt: at("2026-10-05T10:00:00+03:00"), total: "250.00" });
      const summary = await daily("2026-10-05", "2026-10-05");
      expect(summary.totals).toMatchObject({ orderCount: 1 });
      expect([summary.totals.grossSales, summary.totals.refunds, summary.totals.revenue].map((v) => v.toFixed(2))).toEqual(["250.00", "0.00", "250.00"]);
    });

    it("a full refund on the same day nets to zero, and the order still counts as placed", async () => {
      const order = await seedOrder({ placedAt: at("2026-10-05T10:00:00+03:00"), total: "250.00" });
      await payRefund(order._id, "250.00", at("2026-10-05T16:00:00+03:00"));
      const summary = await daily("2026-10-05", "2026-10-05");
      expect(summary.totals.orderCount).toBe(1);
      expect(summary.totals.revenue.toFixed(2)).toBe("0.00");
    });

    it("a partial refund and multiple partial refunds subtract exactly what was refunded", async () => {
      const order = await seedOrder({ placedAt: at("2026-10-05T10:00:00+03:00"), total: "100.00" });
      await returnRefund(order._id, "15.50", at("2026-10-05T11:00:00+03:00"));
      await returnRefund(order._id, "20.25", at("2026-10-05T12:00:00+03:00"));
      await payRefund(order._id, "4.25", at("2026-10-05T13:00:00+03:00"));
      const summary = await daily("2026-10-05", "2026-10-05");
      expect(summary.totals.refunds.toFixed(2)).toBe("40.00");
      expect(summary.totals.revenue.toFixed(2)).toBe("60.00");
    });

    it("a rejected over-refund leaves revenue untouched", async () => {
      const order = await seedOrder({ placedAt: at("2026-10-05T10:00:00+03:00"), total: "100.00" });
      await returnRefund(order._id, "90.00", at("2026-10-05T11:00:00+03:00"));
      await expect(payRefund(order._id, "10.01", at("2026-10-05T12:00:00+03:00"))).rejects.toThrow(ConflictError);
      expect((await daily("2026-10-05", "2026-10-05")).totals.revenue.toFixed(2)).toBe("10.00");
    });

    it("never double-counts: each refund appears once, and a repeated refund of the same return is refused", async () => {
      const order = await seedOrder({ placedAt: at("2026-10-05T10:00:00+03:00"), total: "100.00" });
      const refunded = await returnRefund(order._id, "30.00", at("2026-10-05T11:00:00+03:00"));
      await expect(
        refundReturn({ returnId: refunded._id.toString(), refundReference: "again", amount: toMoney("30.00"), staffId, now: at("2026-10-05T12:00:00+03:00") })
      ).rejects.toThrow(ConflictError);
      await payRefund(order._id, "20.00", at("2026-10-05T13:00:00+03:00"));
      expect((await daily("2026-10-05", "2026-10-05")).totals.refunds.toFixed(2)).toBe("50.00");
    });

    it("a refund in a later month counts in that month — 10,000 in September, −2,000 in October, 8,000 combined", async () => {
      const order = await seedOrder({ placedAt: at("2026-09-20T10:00:00+03:00"), total: "10000.00" });
      await payRefund(order._id, "2000.00", at("2026-10-10T10:00:00+03:00"));

      const monthly = await getSalesSummary({ granularity: "month", from: "2026-09-01", to: "2026-10-31", now });
      expect(revenue(monthly)).toEqual([
        ["2026-09", "10000.00"],
        ["2026-10", "-2000.00"],
      ]);
      expect(monthly.periods[1].orderCount).toBe(0);
      expect(monthly.totals.revenue.toFixed(2)).toBe("8000.00");

      // A report of September alone is unaffected by October's refund.
      const september = await getSalesSummary({ granularity: "month", from: "2026-09-01", to: "2026-09-30", now });
      expect(september.totals.revenue.toFixed(2)).toBe("10000.00");
    });

    it("dates a refund in STORE_TIMEZONE: 00:30 on 1 Oct in Cairo is 30 Sep in New York", async () => {
      const order = await seedOrder({ placedAt: at("2026-09-29T12:00:00+03:00"), total: "100.00" });
      await payRefund(order._id, "40.00", at("2026-10-01T00:30:00+03:00"));

      expect(revenue(await daily("2026-09-30", "2026-10-01"))).toEqual([
        ["2026-09-30", "0.00"],
        ["2026-10-01", "-40.00"],
      ]);

      process.env.STORE_TIMEZONE = "America/New_York";
      try {
        expect(revenue(await daily("2026-09-30", "2026-10-01"))).toEqual([
          ["2026-09-30", "-40.00"],
          ["2026-10-01", "0.00"],
        ]);
      } finally {
        process.env.STORE_TIMEZONE = "Africa/Cairo";
      }
    });

    it("a cancelled order contributes nothing — neither its sale nor its refund", async () => {
      const kept = await seedOrder({ placedAt: at("2026-10-05T10:00:00+03:00"), total: "100.00" });
      const cancelled = await seedOrder({ placedAt: at("2026-10-05T10:00:00+03:00"), total: "500.00" });
      await payRefund(cancelled._id, "500.00", at("2026-10-05T11:00:00+03:00"));
      await returnRefund(kept._id, "10.00", at("2026-10-05T11:00:00+03:00"));
      await OrderModel.updateOne({ _id: cancelled._id }, { $set: { status: "CANCELLED" } });

      const summary = await daily("2026-10-05", "2026-10-05");
      expect(summary.totals.orderCount).toBe(1);
      expect([summary.totals.grossSales, summary.totals.refunds, summary.totals.revenue].map((v) => v.toFixed(2))).toEqual(["100.00", "10.00", "90.00"]);
    });
  });

  describe("getStockHealth", () => {
    it("lists out-of-stock and low variants most-urgent first, excluding healthy and discontinued", async () => {
      const out = await seedVariant({ stock: 0 });
      const low = await seedVariant({ stock: 3 }); // store default threshold 5
      await seedVariant({ stock: 20 }); // healthy
      await seedVariant({ stock: 0, discontinued: true }); // not a reorder signal
      const overridden = await seedVariant({ stock: 8, lowStockThreshold: 10 }); // low by its own threshold

      const report = await getStockHealth({ page: 1, limit: 10 });

      expect(report.defaultThreshold).toBe(5);
      expect(report.outOfStockCount).toBe(1);
      expect(report.lowStockCount).toBe(2);
      expect(report.total).toBe(3);
      expect(report.data.map((row) => [row._id, row.health, row.effectiveThreshold])).toEqual([
        [out._id.toString(), "OUT_OF_STOCK", 5],
        [low._id.toString(), "LOW_STOCK", 5],
        [overridden._id.toString(), "LOW_STOCK", 10],
      ]);
      expect(report.data[0].productName.en).toBe("Shirt");
    });

    it("uses the saved store-wide threshold", async () => {
      await InventorySettingsModel.create({ lowStockThreshold: 2 });
      await seedVariant({ stock: 3 });

      const report = await getStockHealth({ page: 1, limit: 10 });
      expect(report.defaultThreshold).toBe(2);
      expect(report.total).toBe(0);
    });
  });

  describe("getPaymentAgeing", () => {
    it("ages each awaiting transfer from its proof submission, oldest first", async () => {
      const now = new Date();
      const recent = await seedOrder({ placedAt: new Date(now.getTime() - 3 * HOUR_MS), total: "100.00", paymentStatus: "SUBMITTED" });
      const stale = await seedOrder({ placedAt: new Date(now.getTime() - 80 * HOUR_MS), total: "250.00", paymentStatus: "SUBMITTED" });
      await seedOrder({ placedAt: new Date(now.getTime() - 90 * HOUR_MS), total: "1.00" }); // not awaiting review

      await PaymentProofModel.create({
        orderId: recent._id,
        submittedAt: new Date(now.getTime() - 2 * HOUR_MS),
        asset: { publicId: "proofs/a", format: "jpg", bytes: 100, mimeType: "image/jpeg", filename: "a.jpg" },
        status: "SUBMITTED",
      });
      await PaymentProofModel.create({
        orderId: stale._id,
        submittedAt: new Date(now.getTime() - 50 * HOUR_MS),
        asset: { publicId: "proofs/b", format: "jpg", bytes: 100, mimeType: "image/jpeg", filename: "b.jpg" },
        status: "SUBMITTED",
      });

      const report = await getPaymentAgeing(now);

      expect(report.count).toBe(2);
      expect(report.items.map((item) => [item.orderNumber, item.waitingHours, item.band])).toEqual([
        [stale.orderNumber, 50, "OVER_48H"],
        [recent.orderNumber, 2, "UNDER_24H"],
      ]);
      expect(report.oldestWaitingHours).toBe(50);
      expect(report.items[0].expectedAmount.toFixed(2)).toBe("250.00");
    });

    it("falls back to placement time for a SUBMITTED order with no proof row", async () => {
      const now = new Date();
      await seedOrder({ placedAt: new Date(now.getTime() - 30 * HOUR_MS), total: "10.00", paymentStatus: "SUBMITTED" });

      const report = await getPaymentAgeing(now);
      expect(report.items[0].waitingHours).toBe(30);
      expect(report.items[0].band).toBe("24H_TO_48H");
    });
  });
});
