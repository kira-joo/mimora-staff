import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { derivePromotionContext, derivePromotionContextForActor } from "./derive-promotion-context";
import { OrderLineModel, OrderModel } from "../../commerce/order.schema";
import { connectToDatabase } from "../../core/db/connect";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

function pickupOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
    fulfilment: { mode: "PICKUP" as const, fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123 Main", phone: "555-0100" } },
    payment: { method: "COD", status: "NOT_REQUIRED" as const },
    discount: new Decimal("0"),
    tax: new Decimal("0"),
    ...overrides,
  };
}

describe("derivePromotionContext", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  beforeEach(async () => {
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("derives isFirstOrder=true when customer has no non-cancelled orders", async () => {
    const customerId = new mongoose.Types.ObjectId().toString();

    const result = await derivePromotionContext(customerId);

    expect(result.isFirstOrder).toBe(true);
    expect(result.customerUses).toBe(0);
  });

  it("derives isFirstOrder=false when customer has a non-cancelled order", async () => {
    const customerId = new mongoose.Types.ObjectId().toString();

    await OrderModel.create({
      orderNumber: "ORD-010001",
      customerId,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      ...pickupOrder(),
    });

    const result = await derivePromotionContext(customerId);

    expect(result.isFirstOrder).toBe(false);
    expect(result.customerUses).toBe(0);
  });

  it("ignores cancelled orders when deriving isFirstOrder", async () => {
    const customerId = new mongoose.Types.ObjectId().toString();

    await OrderModel.create({
      orderNumber: "ORD-010002",
      customerId,
      status: "CANCELLED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      ...pickupOrder(),
    });

    const result = await derivePromotionContext(customerId);

    expect(result.isFirstOrder).toBe(true);
    expect(result.customerUses).toBe(0);
  });

  it("counts the customer's non-cancelled orders that used the code (from the lines' promotion snapshot)", async () => {
    const customerId = new mongoose.Types.ObjectId().toString();
    const other = new mongoose.Types.ObjectId().toString();
    const orders = await OrderModel.create([
      { orderNumber: "ORD-010101", customerId, status: "PLACED", placedAt: new Date(), subtotal: new Decimal("10"), total: new Decimal("10"), ...pickupOrder() },
      { orderNumber: "ORD-010102", customerId, status: "DELIVERED", placedAt: new Date(), subtotal: new Decimal("10"), total: new Decimal("10"), ...pickupOrder() },
      { orderNumber: "ORD-010103", customerId, status: "CANCELLED", placedAt: new Date(), subtotal: new Decimal("10"), total: new Decimal("10"), ...pickupOrder() },
      { orderNumber: "ORD-010104", customerId: other, status: "PLACED", placedAt: new Date(), subtotal: new Decimal("10"), total: new Decimal("10"), ...pickupOrder() },
    ]);
    const line = (orderId: mongoose.Types.ObjectId, lineNumber: number, promotionCode?: string) => ({
      orderId, lineNumber, variantId: new mongoose.Types.ObjectId(), sku: `S-${lineNumber}`, productName: "P", variantDescription: "P",
      quantity: 1, unitPrice: new Decimal("10"), lineTotal: new Decimal("10"), ...(promotionCode ? { promotionCode } : {}),
    });
    await OrderLineModel.create([
      line(orders[0]!._id, 1, "SAVE10"), line(orders[0]!._id, 2, "SAVE10"), // two lines, ONE use
      line(orders[1]!._id, 1, "SAVE10"),
      line(orders[2]!._id, 1, "SAVE10"), // cancelled: the use was given back
      line(orders[3]!._id, 1, "SAVE10"), // someone else's
    ]);

    expect(await derivePromotionContext(customerId, { id: new mongoose.Types.ObjectId().toString(), code: "save10" })).toEqual({ isFirstOrder: false, customerUses: 2 });
    expect((await derivePromotionContext(customerId, { id: new mongoose.Types.ObjectId().toString(), code: "OTHER" })).customerUses).toBe(0);
    expect((await derivePromotionContext(customerId)).customerUses).toBe(0);
  });

  it("derivePromotionContextForActor: a guest is never a first-order customer, and a per-customer limit is treated as used up", async () => {
    expect(await derivePromotionContextForActor({ kind: "guest", cartToken: "t" }, { id: "x", code: "SAVE10" })).toEqual({ isFirstOrder: false, customerUses: Number.POSITIVE_INFINITY });
  });

  it("derivePromotionContextForActor: a customer is derived from history, same as placement", async () => {
    const customerId = new mongoose.Types.ObjectId().toString();
    const result = await derivePromotionContextForActor({ kind: "customer", customer: { _id: customerId, name: "x", phone: "x" } });
    expect(result).toEqual(await derivePromotionContext(customerId));
    expect(result.isFirstOrder).toBe(true);
  });
});
