import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { listReturns } from "./list-returns";
import { OrderModel } from "../../commerce/order.schema";
import { ReturnModel, ReturnLineModel } from "../../commerce/return.schema";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

function customerIdentity(): CustomerIdentity {
  return { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
}

async function createOrder(customerId: string, orderNumber: string) {
  return OrderModel.create({
    orderNumber,
    idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
    customerId,
    status: "DELIVERED",
    placedAt: new Date(),
    subtotal: new Decimal("100.00"),
    total: new Decimal("100.00"),
    fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
    payment: { method: "COD", status: "NOT_REQUIRED" },
  });
}

async function createReturn(customerId: string, orderId: mongoose.Types.ObjectId, returnNumber: string, requestedAt: Date, lineCount = 1) {
  const ret = await ReturnModel.create({
    orderId,
    customerId,
    returnNumber,
    reason: "Test reason",
    status: "REQUESTED",
    requestedAt,
  });
  await ReturnLineModel.create(
    Array.from({ length: lineCount }, (_, i) => ({
      returnId: ret._id,
      orderLineId: new mongoose.Types.ObjectId(),
      quantity: 1,
      reason: `reason-${i}`,
      condition: "x",
    }))
  );
  return ret;
}

describe("listReturns", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await OrderModel.deleteMany({});
    await ReturnModel.deleteMany({});
    await ReturnLineModel.deleteMany({});
  });

  it("returns only the authenticated customer's returns, most recent first", async () => {
    const customer1 = customerIdentity();
    const customer2 = customerIdentity();

    const order1 = await createOrder(customer1._id, "ORD-000001");
    const order2 = await createOrder(customer2._id, "ORD-000002");

    await createReturn(customer1._id, order1._id, "RET-000001", new Date("2024-01-01"));
    await createReturn(customer1._id, order1._id, "RET-000002", new Date("2024-01-02"), 2);
    await createReturn(customer2._id, order2._id, "RET-000003", new Date("2024-01-03"));

    const result = await listReturns({ customer: customer1 });

    expect(result).toHaveLength(2);
    expect(result[0]!.returnNumber).toBe("RET-000002"); // most recent first
    expect(result[0]!.lineCount).toBe(2);
    expect(result[0]!.orderNumber).toBe("ORD-000001");
    expect(result[1]!.returnNumber).toBe("RET-000001");
  });

  it("never exposes another customer's returns", async () => {
    const customer1 = customerIdentity();
    const customer2 = customerIdentity();
    const order2 = await createOrder(customer2._id, "ORD-000002");
    await createReturn(customer2._id, order2._id, "RET-000001", new Date());

    const result = await listReturns({ customer: customer1 });

    expect(result).toEqual([]);
  });

  it("respects limit and offset pagination", async () => {
    const customer = customerIdentity();
    const order = await createOrder(customer._id, "ORD-000001");

    for (let i = 1; i <= 5; i++) {
      await createReturn(customer._id, order._id, `RET-00000${i}`, new Date(`2024-01-0${i}`));
    }

    const page1 = await listReturns({ customer, limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);
    expect(page1[0]!.returnNumber).toBe("RET-000005");
    expect(page1[1]!.returnNumber).toBe("RET-000004");

    const page2 = await listReturns({ customer, limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);
    expect(page2[0]!.returnNumber).toBe("RET-000003");
    expect(page2[1]!.returnNumber).toBe("RET-000002");
  });
});
