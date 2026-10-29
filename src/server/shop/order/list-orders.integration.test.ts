import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { listOrders } from "./list-orders";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

function customerIdentity(): CustomerIdentity {
  return { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
}

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

describe("listOrders", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
  });

  it("returns empty array when customer has no orders", async () => {
    const customer = customerIdentity();

    const result = await listOrders({ customer });

    expect(result).toEqual([]);
  });

  it("returns customer's orders sorted by placedAt descending", async () => {
    const customer = customerIdentity();

    const order1 = await OrderModel.create({
      orderNumber: "ORD-001001",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date("2024-01-01T10:00:00Z"),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      ...pickupOrder(),
    });

    const order2 = await OrderModel.create({
      orderNumber: "ORD-001002",
      customerId: customer._id,
      status: "DELIVERED",
      placedAt: new Date("2024-01-02T10:00:00Z"),
      subtotal: new Decimal("200.00"),
      total: new Decimal("190.00"),
      ...pickupOrder({ discount: new Decimal("10.00"), payment: { method: "TRANSFER", status: "VERIFIED" } }),
    });

    await OrderLineModel.create([
      { orderId: order1._id, lineNumber: 1, variantId: order1._id, sku: "SKU1", productName: "P1", variantDescription: "V1", quantity: 2, unitPrice: new Decimal("50"), lineTotal: new Decimal("100") },
      { orderId: order2._id, lineNumber: 1, variantId: order2._id, sku: "SKU2", productName: "P2", variantDescription: "V2", quantity: 1, unitPrice: new Decimal("200"), lineTotal: new Decimal("200") },
      { orderId: order2._id, lineNumber: 2, variantId: order2._id, sku: "SKU3", productName: "P3", variantDescription: "V3", quantity: 1, unitPrice: new Decimal("50"), lineTotal: new Decimal("50") },
    ]);

    const result = await listOrders({ customer });

    expect(result).toHaveLength(2);
    expect(result[0].orderNumber).toBe("ORD-001002"); // most recent first
    expect(result[0].itemCount).toBe(2);
    expect(result[0].total.toFixed(2)).toBe("190.00");
    expect(result[1].orderNumber).toBe("ORD-001001");
    expect(result[1].itemCount).toBe(1);
    expect(result[1].total.toFixed(2)).toBe("100.00");
  });

  it("isolates orders by customer ID", async () => {
    const customer1 = customerIdentity();
    const customer2 = customerIdentity();

    await OrderModel.create({
      orderNumber: "ORD-002001",
      customerId: customer1._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      ...pickupOrder(),
    });

    await OrderModel.create({
      orderNumber: "ORD-002002",
      customerId: customer2._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("75.00"),
      total: new Decimal("75.00"),
      ...pickupOrder(),
    });

    const result1 = await listOrders({ customer: customer1 });
    const result2 = await listOrders({ customer: customer2 });

    expect(result1).toHaveLength(1);
    expect(result1[0].orderNumber).toBe("ORD-002001");

    expect(result2).toHaveLength(1);
    expect(result2[0].orderNumber).toBe("ORD-002002");
  });

  it("respects limit and offset for pagination", async () => {
    const customer = customerIdentity();

    for (let i = 1; i <= 5; i++) {
      await OrderModel.create({
        orderNumber: `ORD-00300${i}`,
        customerId: customer._id,
        status: "PLACED",
        placedAt: new Date(`2024-01-0${i}T10:00:00Z`),
        subtotal: new Decimal("100.00"),
        total: new Decimal("100.00"),
        ...pickupOrder(),
      });
    }

    const page1 = await listOrders({ customer, limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);
    expect(page1[0].orderNumber).toBe("ORD-003005"); // most recent
    expect(page1[1].orderNumber).toBe("ORD-003004");

    const page2 = await listOrders({ customer, limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);
    expect(page2[0].orderNumber).toBe("ORD-003003");
    expect(page2[1].orderNumber).toBe("ORD-003002");

    const page3 = await listOrders({ customer, limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);
    expect(page3[0].orderNumber).toBe("ORD-003001");
  });

  it("uses default limit of 20 when not specified", async () => {
    const customer = customerIdentity();

    for (let i = 1; i <= 25; i++) {
      await OrderModel.create({
        orderNumber: `ORD-004${String(i).padStart(3, "0")}`,
        customerId: customer._id,
        status: "PLACED",
        placedAt: new Date(`2024-01-${String(i).padStart(2, "0")}T10:00:00Z`),
        subtotal: new Decimal("100.00"),
        total: new Decimal("100.00"),
        ...pickupOrder(),
      });
    }

    const result = await listOrders({ customer });

    expect(result).toHaveLength(20);
    expect(result[0].orderNumber).toBe("ORD-004025"); // most recent
  });

  it("returns 0 itemCount when order has no lines", async () => {
    const customer = customerIdentity();

    await OrderModel.create({
      orderNumber: "ORD-005001",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("0"),
      total: new Decimal("0"),
      ...pickupOrder(),
    });

    const result = await listOrders({ customer });

    expect(result).toHaveLength(1);
    expect(result[0].itemCount).toBe(0);
  });

  it("is served by the Order.customerId index — a customer's orders are found without scanning everyone's", async () => {
    const customers = Array.from({ length: 20 }, () => new mongoose.Types.ObjectId());
    await OrderModel.insertMany(
      Array.from({ length: 400 }, (_, i) => ({
        orderNumber: `ORD-IDX-${i}`,
        customerId: customers[i % customers.length],
        idempotencyKey: `idx-${i}`,
        fulfilment: { mode: "PICKUP", fee: new Decimal("0") },
        subtotal: new Decimal("10"),
        total: new Decimal("10"),
        payment: { method: "COD", status: "NOT_REQUIRED" },
        status: "PLACED",
        placedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
      }))
    );

    const indexes = await OrderModel.listIndexes();
    expect(indexes.some((index) => JSON.stringify(index.key) === JSON.stringify({ customerId: 1 }))).toBe(true);

    // The exact shape `listOrders` issues: equality on customerId, newest first.
    const plan = await OrderModel.find({ customerId: customers[3] }).sort({ placedAt: -1 }).limit(20).explain("executionStats");
    const stats = (plan as unknown as { executionStats: { totalDocsExamined: number; nReturned: number } }).executionStats;
    expect(JSON.stringify((plan as unknown as { queryPlanner: unknown }).queryPlanner)).toContain("customerId_1");
    expect(stats.nReturned).toBe(20);
    expect(stats.totalDocsExamined).toBe(20); // only this customer's orders, not all 400
  });
});
