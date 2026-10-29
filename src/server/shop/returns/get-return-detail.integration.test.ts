import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { getReturnDetail } from "./get-return-detail";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { ReturnModel, ReturnLineModel } from "../../commerce/return.schema";
import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

function customerIdentity(): CustomerIdentity {
  return { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
}

describe("getReturnDetail", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await ReturnModel.deleteMany({});
    await ReturnLineModel.deleteMany({});
  });

  it("shows an internal RECEIVED return to the customer as APPROVED — the storefront never meets a status it does not know", async () => {
    const customer = customerIdentity();
    const order = await OrderModel.create({
      orderNumber: "ORD-000009",
      idempotencyKey: "test-key-9",
      customerId: customer._id,
      status: "DELIVERED",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    const ret = await ReturnModel.create({ orderId: order._id, customerId: customer._id, returnNumber: "RET-000009", reason: "r", status: "RECEIVED", requestedAt: new Date() });

    expect((await getReturnDetail({ customer, returnId: ret._id.toString() })).status).toBe("APPROVED");
  });

  it("returns full detail with enriched lines for a return the customer owns", async () => {
    const customer = customerIdentity();
    const order = await OrderModel.create({
      orderNumber: "ORD-000001",
      idempotencyKey: "test-key-1",
      customerId: customer._id,
      status: "DELIVERED",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    const orderLine = await OrderLineModel.create({
      orderId: order._id,
      lineNumber: 1,
      variantId: new mongoose.Types.ObjectId(),
      sku: "SKU-A",
      productName: "Product A",
      variantDescription: "Size M",
      quantity: 2,
      unitPrice: new Decimal("50.00"),
      lineTotal: new Decimal("100.00"),
    });
    const ret = await ReturnModel.create({
      orderId: order._id,
      customerId: customer._id,
      returnNumber: "RET-000001",
      reason: "Changed my mind",
      status: "REQUESTED",
      requestedAt: new Date(),
    });
    await ReturnLineModel.create({
      returnId: ret._id,
      orderLineId: orderLine._id,
      quantity: 1,
      reason: "Too small",
      condition: "Unopened",
    });

    const result = await getReturnDetail({ customer, returnId: ret._id.toString() });

    expect(result.returnNumber).toBe("RET-000001");
    expect(result.orderNumber).toBe("ORD-000001");
    expect(result.status).toBe("REQUESTED");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.sku).toBe("SKU-A");
    expect(result.lines[0]!.productName).toBe("Product A");
    expect(result.lines[0]!.quantity).toBe(1);
    expect(result.lines[0]!.reason).toBe("Too small");
    expect(result.lines[0]!.condition).toBe("Unopened");
    expect(result.lines[0]!.disposition).toBeUndefined();
  });

  it("throws NotFoundError for a nonexistent return id", async () => {
    const customer = customerIdentity();

    await expect(
      getReturnDetail({ customer, returnId: new mongoose.Types.ObjectId().toString() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the return belongs to a different customer", async () => {
    const owner = customerIdentity();
    const intruder = customerIdentity();
    const order = await OrderModel.create({
      orderNumber: "ORD-000002",
      idempotencyKey: "test-key-2",
      customerId: owner._id,
      status: "DELIVERED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    const ret = await ReturnModel.create({
      orderId: order._id,
      customerId: owner._id,
      returnNumber: "RET-000002",
      reason: "x",
      status: "REQUESTED",
      requestedAt: new Date(),
    });

    await expect(
      getReturnDetail({ customer: intruder, returnId: ret._id.toString() })
    ).rejects.toThrow(NotFoundError);
  });
});
