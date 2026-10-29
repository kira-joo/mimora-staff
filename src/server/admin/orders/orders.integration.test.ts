import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { orderRepository, productRepository } from "../../core/repositories";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { StockMovementModel } from "../../catalog/stock-movement.schema";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { FulfilmentSettingsModel } from "../../fulfilment/fulfilment-settings.schema";
import { listOrders } from "./list-orders";
import { getOrderDetailAdmin } from "./get-order-detail";
import { transitionOrderStatus } from "./transition-order-status";
import { updateOrderTracking } from "./update-order-tracking";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const injectedSpies: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  while (injectedSpies.length > 0) injectedSpies.pop()!.mockRestore();
});

/**
 * Rollback-test injection. Lets the real write land, THEN fails the `nth` call
 * to `repo[method]` — so the rollback has a write that genuinely happened to
 * undo. Failing before the write would prove nothing about atomicity.
 */
function failAfterWrite(repo: object, method: string, nth = 1): void {
  const target = repo as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method]!.bind(repo);
  let calls = 0;
  const spy = vi.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
    const result = await original(...args);
    calls += 1;
    if (calls === nth) throw new Error("injected failure");
    return result;
  });
  injectedSpies.push(spy);
}

type SeedOrderOverrides = Partial<{
  status: "PLACED" | "CONFIRMED" | "PROCESSING" | "READY_FOR_PICKUP" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "COLLECTED" | "CANCELLED";
  mode: "DELIVERY" | "PICKUP";
  zone: string;
  paymentStatus: "NOT_REQUIRED" | "AWAITING_PAYMENT" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "REFUNDED";
}>;

async function seedOrder(overrides: SeedOrderOverrides = {}) {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString()}`,
    guestPhone: "+201000000000",
    guestName: "Test Guest",
    idempotencyKey: `k-${new mongoose.Types.ObjectId().toString()}`,
    fulfilment: { mode: overrides.mode ?? "PICKUP", fee: toMoney("0.00"), zone: overrides.zone },
    subtotal: toMoney("10.00"),
    discount: toMoney("0.00"),
    tax: toMoney("0.00"),
    total: toMoney("10.00"),
    payment: overrides.paymentStatus
      ? { method: "WALLET_TRANSFER", status: overrides.paymentStatus }
      : { method: "COD", status: "NOT_REQUIRED" },
    status: overrides.status ?? "PLACED",
    timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    placedAt: new Date(),
  });
}

describe("Admin Orders", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      OrderModel.deleteMany({}),
      OrderLineModel.deleteMany({}),
      VariantModel.deleteMany({}),
      ProductModel.deleteMany({}),
      CategoryModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
      FulfilmentSettingsModel.deleteMany({}),
    ]);
  });

  describe("listOrders", () => {
    it("filters by status, mode and zone", async () => {
      await seedOrder({ status: "PLACED", mode: "PICKUP" });
      await seedOrder({ status: "DELIVERED", mode: "DELIVERY", zone: "cairo" });

      const placed = await listOrders({ limit: 10, page: 1, status: "PLACED" });
      expect(placed.total).toBe(1);

      const delivery = await listOrders({ limit: 10, page: 1, mode: "DELIVERY", zone: "cairo" });
      expect(delivery.total).toBe(1);

      const all = await listOrders({ limit: 10, page: 1 });
      expect(all.total).toBe(2);
    });
  });

  describe("getOrderDetailAdmin", () => {
    it("returns the full snapshot including timeline", async () => {
      const order = await seedOrder();
      const detail = await getOrderDetailAdmin(order._id.toString());

      expect(detail.orderNumber).toBe(order.orderNumber);
      expect(detail.timeline).toHaveLength(1);
      expect(detail.total.toFixed(2)).toBe("10.00");
    });

    it("reports what has been refunded so far — zero until a refund is recorded", async () => {
      const order = await seedOrder();
      expect((await getOrderDetailAdmin(order._id.toString())).refundedTotal.toFixed(2)).toBe("0.00");

      await OrderModel.updateOne({ _id: order._id }, { $set: { refundedTotal: toMoney("4.50") } });
      expect((await getOrderDetailAdmin(order._id.toString())).refundedTotal.toFixed(2)).toBe("4.50");
    });

    it("shows the terms version the customer accepted, and when (D-13)", async () => {
      const order = await seedOrder();
      const acceptedAt = new Date("2026-10-12T10:00:00Z");
      await OrderModel.updateOne({ _id: order._id }, { $set: { termsVersionAccepted: 3, acceptedAt } });

      const detail = await getOrderDetailAdmin(order._id.toString());
      expect(detail.termsVersionAccepted).toBe(3);
      expect(detail.acceptedAt?.toISOString()).toBe(acceptedAt.toISOString());
    });

    it("leaves terms acceptance absent on an order placed before it was recorded", async () => {
      const order = await seedOrder();
      expect((await getOrderDetailAdmin(order._id.toString())).termsVersionAccepted).toBeUndefined();
    });

    it("throws NotFoundError for a non-existent order", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(getOrderDetailAdmin(fakeId)).rejects.toThrow(NotFoundError);
    });
  });

  describe("transitionOrderStatus", () => {
    it("confirms a placed order and appends a timeline entry", async () => {
      const order = await seedOrder({ status: "PLACED" });
      const staffId = new mongoose.Types.ObjectId().toString();

      const updated = await transitionOrderStatus({ orderId: order._id.toString(), to: "CONFIRMED", staffId, now: new Date() });

      expect(updated.status).toBe("CONFIRMED");
      expect(updated.timeline).toHaveLength(2);
      expect(updated.timeline[1]?.actorType).toBe("STAFF");
    });

    it("cancels an order and releases held stock", async () => {
      const category = await CategoryModel.create({ slug: "test-cat" });
      const product = await ProductModel.create({
        slug: `product-${new mongoose.Types.ObjectId().toString()}`,
        categoryId: category._id,
        lifecycle: "published",
        name: { en: "Test", ar: "تجربة" },
      });
      const variant = await VariantModel.create({
        productId: product._id,
        sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
        variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
        price: toMoney("10.00"),
        stock: 5,
      });

      const order = await seedOrder({ status: "PROCESSING" });
      await OrderLineModel.create({
        orderId: order._id,
        lineNumber: 1,
        variantId: variant._id,
        sku: variant.sku,
        productName: "Test",
        variantDescription: "Default",
        quantity: 2,
        unitPrice: toMoney("10.00"),
        lineTotal: toMoney("20.00"),
      });

      const staffId = new mongoose.Types.ObjectId().toString();
      const updated = await transitionOrderStatus({
        orderId: order._id.toString(),
        to: "CANCELLED",
        reason: "Out of stock upstream",
        staffId,
        now: new Date(),
      });

      expect(updated.status).toBe("CANCELLED");

      const restockedVariant = await VariantModel.findById(variant._id).lean();
      expect(restockedVariant?.stock).toBe(7); // 5 + 2 released
    });

    it("records the release as a stock movement attributed to the order and the staff member who cancelled", async () => {
      const category = await CategoryModel.create({ slug: "attr-cat" });
      const product = await ProductModel.create({ slug: `product-${new mongoose.Types.ObjectId()}`, categoryId: category._id, lifecycle: "published", name: { en: "Test", ar: "تجربة" } });
      const variant = await VariantModel.create({ productId: product._id, sku: `SKU-${new mongoose.Types.ObjectId()}`, variantKey: `key-${new mongoose.Types.ObjectId()}`, price: toMoney("10.00"), stock: 5 });
      const order = await seedOrder({ status: "PROCESSING" });
      await OrderLineModel.create({ orderId: order._id, lineNumber: 1, variantId: variant._id, sku: variant.sku, productName: "Test", variantDescription: "Default", quantity: 2, unitPrice: toMoney("10.00"), lineTotal: toMoney("20.00") });
      const staffId = new mongoose.Types.ObjectId().toString();
      const now = new Date("2026-10-23T10:00:00.000Z");

      await transitionOrderStatus({ orderId: order._id.toString(), to: "CANCELLED", reason: "x", staffId, now });

      const movement = await StockMovementModel.findOne({ variantId: variant._id }).lean();
      expect(movement).toMatchObject({ delta: 2, reason: "RETURN" });
      expect(movement?.orderId?.toString()).toBe(order._id.toString());
      expect(movement?.actorId?.toString()).toBe(staffId);
      expect(movement?.at.toISOString()).toBe(now.toISOString());
    });

    it("throws ConflictError when cancelling without a reason", async () => {
      const order = await seedOrder({ status: "PLACED" });
      await expect(
        transitionOrderStatus({ orderId: order._id.toString(), to: "CANCELLED", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow(ConflictError);
    });

    it("throws ConflictError on an invalid transition", async () => {
      const order = await seedOrder({ status: "DELIVERED" });
      await expect(
        transitionOrderStatus({ orderId: order._id.toString(), to: "CONFIRMED", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent order", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(
        transitionOrderStatus({ orderId: fakeId, to: "CONFIRMED", staffId: fakeId, now: new Date() })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("transitionOrderStatus payment guard", () => {
    const staffId = () => new mongoose.Types.ObjectId().toString();
    const MESSAGE = "Payment has not been verified — verify the receipt before shipping.";

    async function seedWithStock(status: "PROCESSING" | "SHIPPED" | "IN_TRANSIT" | "READY_FOR_PICKUP", mode: "DELIVERY" | "PICKUP", paymentStatus: SeedOrderOverrides["paymentStatus"]) {
      const category = await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId()}` });
      const product = await ProductModel.create({
        slug: `product-${new mongoose.Types.ObjectId()}`,
        categoryId: category._id,
        lifecycle: "published",
        name: { en: "Test", ar: "تجربة" },
      });
      const variant = await VariantModel.create({
        productId: product._id,
        sku: `SKU-${new mongoose.Types.ObjectId()}`,
        variantKey: `key-${new mongoose.Types.ObjectId()}`,
        price: toMoney("10.00"),
        stock: 5,
      });
      const order = await seedOrder({ status, mode, paymentStatus });
      return { order, variant };
    }

    const CASES = [
      { from: "PROCESSING", to: "SHIPPED", mode: "DELIVERY" },
      { from: "PROCESSING", to: "READY_FOR_PICKUP", mode: "PICKUP" },
      { from: "SHIPPED", to: "DELIVERED", mode: "DELIVERY" },
      { from: "SHIPPED", to: "IN_TRANSIT", mode: "DELIVERY" },
      { from: "IN_TRANSIT", to: "DELIVERED", mode: "DELIVERY" },
      { from: "READY_FOR_PICKUP", to: "COLLECTED", mode: "PICKUP" },
    ] as const;

    for (const { from, to, mode } of CASES) {
      for (const paymentStatus of ["AWAITING_PAYMENT", "SUBMITTED", "REJECTED"] as const) {
        it(`refuses ${from} -> ${to} while payment is ${paymentStatus}, leaving order, timeline and stock untouched`, async () => {
          const { order, variant } = await seedWithStock(from, mode, paymentStatus);

          await expect(transitionOrderStatus({ orderId: order._id.toString(), to, staffId: staffId(), now: new Date() })).rejects.toThrow(MESSAGE);

          const after = await OrderModel.findById(order._id).lean();
          expect(after?.status).toBe(from);
          expect(after?.timeline).toHaveLength(1);
          expect(after?.payment.status).toBe(paymentStatus);
          expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(5);
        });
      }
    }

    it("still lets staff cancel an unpaid transfer order (and releases its stock)", async () => {
      const { order } = await seedWithStock("PROCESSING", "DELIVERY", "AWAITING_PAYMENT");
      const updated = await transitionOrderStatus({ orderId: order._id.toString(), to: "CANCELLED", reason: "No payment", staffId: staffId(), now: new Date() });
      expect(updated.status).toBe("CANCELLED");
    });

    it("lets a COD order ship and be delivered while unpaid", async () => {
      const order = await seedOrder({ status: "PROCESSING", mode: "DELIVERY" });
      await transitionOrderStatus({ orderId: order._id.toString(), to: "SHIPPED", staffId: staffId(), now: new Date() });
      const delivered = await transitionOrderStatus({ orderId: order._id.toString(), to: "DELIVERED", staffId: staffId(), now: new Date() });
      expect(delivered.status).toBe("DELIVERED");
    });

    it("allows shipping once payment is VERIFIED", async () => {
      const order = await seedOrder({ status: "PROCESSING", mode: "DELIVERY", paymentStatus: "VERIFIED" });
      const updated = await transitionOrderStatus({ orderId: order._id.toString(), to: "SHIPPED", staffId: staffId(), now: new Date() });
      expect(updated.status).toBe("SHIPPED");
    });
  });

  describe("transitionOrderStatus rollback", () => {
    it("reverts status, timeline, released stock and rollup when the transaction fails after the rollup write", async () => {
      const category = await CategoryModel.create({ slug: "rb-cat" });
      const product = await ProductModel.create({
        slug: `product-${new mongoose.Types.ObjectId().toString()}`,
        categoryId: category._id,
        lifecycle: "published",
        name: { en: "Test", ar: "تجربة" },
      });
      const variant = await VariantModel.create({
        productId: product._id,
        sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
        variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
        price: toMoney("10.00"),
        stock: 5,
      });
      const order = await seedOrder({ status: "PROCESSING" });
      await OrderLineModel.create({
        orderId: order._id,
        lineNumber: 1,
        variantId: variant._id,
        sku: variant.sku,
        productName: "Test",
        variantDescription: "Default",
        quantity: 2,
        unitPrice: toMoney("10.00"),
        lineTotal: toMoney("20.00"),
      });
      const listingBefore = (await ProductModel.findById(product._id).lean())?.listing;
      failAfterWrite(productRepository, "updateAtomic", 1); // the rollup write, last in the transaction

      await expect(
        transitionOrderStatus({ orderId: order._id.toString(), to: "CANCELLED", reason: "x", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow("injected failure");

      const after = await OrderModel.findById(order._id).lean();
      expect(after?.status).toBe("PROCESSING");
      expect(after?.timeline).toHaveLength(1);
      expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(5);
      expect((await ProductModel.findById(product._id).lean())?.listing).toEqual(listingBefore);
    });
  });

  describe("updateOrderTracking", () => {
    const CARRIER = { key: "aramex", name: "Aramex", urlTemplate: "https://carrier.example/track/{tracking}" };
    const seedShipped = async () => {
      await FulfilmentSettingsModel.create({ carriers: [CARRIER] });
      return seedOrder({ status: "SHIPPED", mode: "DELIVERY" });
    };
    const input = (orderId: string, trackingNumber = "TRK-1001") => ({ orderId, tracking: { carrierKey: CARRIER.key, trackingNumber }, staffId: new mongoose.Types.ObjectId().toString(), now: new Date() });

    it("snapshots the carrier and link on the order and records ORDER_TRACKING_UPDATED on the timeline", async () => {
      const order = await seedShipped();

      const updated = await updateOrderTracking(input(order._id.toString()));

      expect(updated.tracking).toMatchObject({ carrierKey: "aramex", carrierName: "Aramex", trackingNumber: "TRK-1001", url: "https://carrier.example/track/TRK-1001" });
      const after = await OrderModel.findById(order._id).lean();
      expect(after?.timeline.map((entry) => entry.type)).toEqual(["ORDER_PLACED", "ORDER_TRACKING_UPDATED"]);
    });

    it("refuses an order that has not shipped", async () => {
      await FulfilmentSettingsModel.create({ carriers: [CARRIER] });
      const order = await seedOrder({ status: "PROCESSING", mode: "DELIVERY" });
      await expect(updateOrderTracking(input(order._id.toString()))).rejects.toThrow(ConflictError);
    });

    describe("rollback — the tracking snapshot and its timeline entry are one write", () => {
      it("first entry: a failure after the timeline entry leaves no tracking and no timeline entry", async () => {
        const order = await seedShipped();
        const before = await OrderModel.collection.findOne({ _id: order._id });
        // orderRepository.updateAtomic runs twice: 1 = the tracking $set, 2 = the timeline $push. Both have landed when #2 throws.
        failAfterWrite(orderRepository, "updateAtomic", 2);

        await expect(updateOrderTracking(input(order._id.toString()))).rejects.toThrow("injected failure");

        expect(await OrderModel.collection.findOne({ _id: order._id })).toEqual(before);
        expect((await OrderModel.findById(order._id).lean())?.tracking).toBeUndefined();
      });

      it("a correction: a failure after the timeline entry leaves the previous tracking and the timeline as they were", async () => {
        const order = await seedShipped();
        await updateOrderTracking(input(order._id.toString(), "TRK-OLD"));
        const before = await OrderModel.collection.findOne({ _id: order._id });
        failAfterWrite(orderRepository, "updateAtomic", 2);

        await expect(updateOrderTracking(input(order._id.toString(), "TRK-NEW"))).rejects.toThrow("injected failure");

        expect(await OrderModel.collection.findOne({ _id: order._id })).toEqual(before);
        expect((await OrderModel.findById(order._id).lean())?.tracking?.trackingNumber).toBe("TRK-OLD");
      });
    });
  });
});
