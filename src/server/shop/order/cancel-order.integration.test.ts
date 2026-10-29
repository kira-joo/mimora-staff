import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { variantRepository } from "../../core/repositories";
import { connectToDatabase } from "../../core/db/connect";
import { cancelOrder } from "./cancel-order";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { StockMovementModel } from "../../catalog/stock-movement.schema";
import { FulfilmentSettingsModel } from "../../fulfilment/fulfilment-settings.schema";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";

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

function customerIdentity(): CustomerIdentity {
  return { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
}

async function createFulfilmentSettings(customerCancelWindowMinutes = 30) {
  return FulfilmentSettingsModel.create({
    deliveryEnabled: true,
    pickupEnabled: true,
    shippingFeeMode: "FLAT",
    flatShippingFee: new Decimal("5.00"),
    defaultDispatchLeadDays: 2,
    cutoffTime: "14:00",
    orderMinimum: new Decimal("0"),
    customerCancelWindowMinutes,
    tax: { mode: "INCLUDED", rate: 0 },
  });
}

describe("cancelOrder", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    // FulfilmentSettings is a singleton this file writes; clear it so a
    // later test file sharing this database doesn't inherit it.
    await FulfilmentSettingsModel.deleteMany({});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await VariantModel.deleteMany({});
    await FulfilmentSettingsModel.deleteMany({});
  });

  it("cancels a PLACED order, restores stock, and appends an ORDER_CANCELLED timeline entry", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();

    const variant = await VariantModel.create({
      productId: new mongoose.Types.ObjectId(),
      sku: "SKU-CANCEL",
      variantKey: "cancel-key-1",
      stock: 8,
      price: new Decimal("50.00"),
      backorderPolicy: "DENY",
    });

    const order = await OrderModel.create({
      orderNumber: "ORD-007001",
      idempotencyKey: "ORD-007001",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    await OrderLineModel.create({
      orderId: order._id,
      lineNumber: 1,
      variantId: variant._id,
      sku: "SKU-CANCEL",
      productName: "Product",
      variantDescription: "Default",
      quantity: 2,
      unitPrice: new Decimal("50.00"),
      lineTotal: new Decimal("100.00"),
    });

    const result = await cancelOrder({ customer, orderNumber: "ORD-007001", reason: "Changed my mind", now: new Date() });

    expect(result.success).toBe(true);

    const updatedOrder = await OrderModel.findOne({ orderNumber: "ORD-007001" }).lean();
    expect(updatedOrder?.status).toBe("CANCELLED");
    expect(updatedOrder?.timeline).toHaveLength(1);
    expect(updatedOrder?.timeline[0].type).toBe("ORDER_CANCELLED");
    expect(updatedOrder?.timeline[0].actorType).toBe("CUSTOMER");
    expect(updatedOrder?.timeline[0].reason).toBe("Changed my mind");

    const updatedVariant = await VariantModel.findById(variant._id).lean();
    expect(updatedVariant?.stock).toBe(10); // restored: 8 + 2
  });

  it("defaults the timeline reason when the customer supplies none", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();

    await OrderModel.create({
      orderNumber: "ORD-007002",
      idempotencyKey: "ORD-007002",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const result = await cancelOrder({ customer, orderNumber: "ORD-007002", now: new Date() });

    expect(result.success).toBe(true);
    const updatedOrder = await OrderModel.findOne({ orderNumber: "ORD-007002" }).lean();
    expect(updatedOrder?.timeline[0].reason).toBeTruthy();
  });

  it("throws NotFoundError when order does not exist", async () => {
    const customer = customerIdentity();

    await expect(
      cancelOrder({ customer, orderNumber: "ORD-009999", now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when order belongs to a different customer", async () => {
    const customer1 = customerIdentity();
    const customer2 = customerIdentity();
    await createFulfilmentSettings();

    await OrderModel.create({
      orderNumber: "ORD-007003",
      idempotencyKey: "ORD-007003",
      customerId: customer1._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    await expect(
      cancelOrder({ customer: customer2, orderNumber: "ORD-007003", now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when outside the cancellation window", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();

    const placedAt = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago

    await OrderModel.create({
      orderNumber: "ORD-007004",
      idempotencyKey: "ORD-007004",
      customerId: customer._id,
      status: "PLACED",
      placedAt,
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    await expect(
      cancelOrder({ customer, orderNumber: "ORD-007004", now: new Date() })
    ).rejects.toThrow(ConflictError);
  });

  it("records the stock release as a movement attributed to the order and the customer", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    await StockMovementModel.deleteMany({});
    const variant = await VariantModel.create({ productId: new mongoose.Types.ObjectId(), sku: "SKU-ATTR", variantKey: "attr-key", stock: 8, price: new Decimal("50.00"), backorderPolicy: "DENY" });
    const order = await OrderModel.create({
      orderNumber: "ORD-007400",
      idempotencyKey: "ORD-007400",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    await OrderLineModel.create({ orderId: order._id, lineNumber: 1, variantId: variant._id, sku: "SKU-ATTR", productName: "P", variantDescription: "D", quantity: 2, unitPrice: new Decimal("50.00"), lineTotal: new Decimal("100.00") });

    await cancelOrder({ customer, orderNumber: "ORD-007400", now: new Date() });

    const movement = await StockMovementModel.findOne({ variantId: variant._id }).lean();
    expect(movement).toMatchObject({ delta: 2, reason: "RETURN" });
    expect(movement?.orderId?.toString()).toBe(order._id.toString());
    expect(movement?.actorId?.toString()).toBe(customer._id);
    await StockMovementModel.deleteMany({});
  });

  describe("the deadline snapshotted at placement (Order.customerCancelUntil)", () => {
    const seedWithDeadline = async (orderNumber: string, customer: CustomerIdentity, placedAt: Date, customerCancelUntil: Date | undefined) =>
      OrderModel.create({
        orderNumber,
        idempotencyKey: orderNumber,
        customerId: customer._id,
        status: "PLACED",
        placedAt,
        customerCancelUntil,
        subtotal: new Decimal("50.00"),
        total: new Decimal("50.00"),
        fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
        payment: { method: "COD", status: "NOT_REQUIRED" },
      });

    it("still cancels inside the order's own deadline although the merchant has since narrowed the window to nothing", async () => {
      const customer = customerIdentity();
      await createFulfilmentSettings(0); // today's setting would refuse anything but an instant cancel
      const now = new Date();
      await seedWithDeadline("ORD-007301", customer, new Date(now.getTime() - 10 * 60_000), new Date(now.getTime() + 5 * 60_000));

      await expect(cancelOrder({ customer, orderNumber: "ORD-007301", now })).resolves.toEqual({ success: true });
      expect((await OrderModel.findOne({ orderNumber: "ORD-007301" }).lean())?.status).toBe("CANCELLED");
    });

    it("refuses past the order's own deadline although the merchant has since widened the window", async () => {
      const customer = customerIdentity();
      await createFulfilmentSettings(24 * 60); // today's setting would allow a whole day
      const now = new Date();
      await seedWithDeadline("ORD-007302", customer, new Date(now.getTime() - 10 * 60_000), new Date(now.getTime() - 5 * 60_000));

      await expect(cancelOrder({ customer, orderNumber: "ORD-007302", now })).rejects.toThrow(ConflictError);
      expect((await OrderModel.findOne({ orderNumber: "ORD-007302" }).lean())?.status).toBe("PLACED");
    });

    it("an order placed before the snapshot existed (no deadline) falls back to placedAt + the current window", async () => {
      const customer = customerIdentity();
      await createFulfilmentSettings(30);
      const now = new Date();
      await seedWithDeadline("ORD-007303", customer, new Date(now.getTime() - 10 * 60_000), undefined);

      await expect(cancelOrder({ customer, orderNumber: "ORD-007303", now })).resolves.toEqual({ success: true });
    });
  });

  it("throws ConflictError when the order is already terminal", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();

    await OrderModel.create({
      orderNumber: "ORD-007005",
      idempotencyKey: "ORD-007005",
      customerId: customer._id,
      status: "DELIVERED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "VERIFIED" },
    });

    await expect(
      cancelOrder({ customer, orderNumber: "ORD-007005", now: new Date() })
    ).rejects.toThrow(ConflictError);
  });

  it("rolls back status, timeline AND restored stock when the transaction fails after the stock release lands", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const variant = await VariantModel.create({
      productId: new mongoose.Types.ObjectId(),
      sku: "SKU-CANCEL-RB",
      variantKey: "cancel-rb-key",
      stock: 8,
      price: new Decimal("50.00"),
      backorderPolicy: "DENY",
    });
    const order = await OrderModel.create({
      orderNumber: "ORD-007100",
      idempotencyKey: "ORD-007100",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date(Date.now() - 5 * 60 * 1000),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    await OrderLineModel.create({
      orderId: order._id,
      lineNumber: 1,
      variantId: variant._id,
      sku: "SKU-CANCEL-RB",
      productName: "Product",
      variantDescription: "Default",
      quantity: 2,
      unitPrice: new Decimal("50.00"),
      lineTotal: new Decimal("100.00"),
    });

    // Order status write + timeline append already happened; now the stock increment lands and the call fails.
    failAfterWrite(variantRepository, "updateAtomic", 1);

    await expect(cancelOrder({ customer, orderNumber: "ORD-007100", now: new Date() })).rejects.toThrow("injected failure");

    const after = await OrderModel.findById(order._id).lean();
    expect(after?.status).toBe("PLACED");
    expect(after?.timeline).toHaveLength(0);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(8);
  });
});
