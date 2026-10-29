import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { requestReturn } from "./request-return";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { ReturnModel, ReturnLineModel } from "../../commerce/return.schema";
import { returnLineRepository } from "../../core/repositories";
import { ReturnSequenceModel } from "../../commerce/return-sequence.schema";
import { FulfilmentSettingsModel } from "../../fulfilment/fulfilment-settings.schema";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

function customerIdentity(): CustomerIdentity {
  return { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
}

async function createFulfilmentSettings(returnWindowDays = 14) {
  return FulfilmentSettingsModel.create({
    deliveryEnabled: true,
    pickupEnabled: true,
    shippingFeeMode: "FLAT",
    flatShippingFee: new Decimal("5.00"),
    defaultDispatchLeadDays: 2,
    orderMinimum: new Decimal("0"),
    customerCancelWindowMinutes: 30,
    returnWindowDays,
    tax: { mode: "INCLUDED", rate: 0 },
  });
}

async function createDeliveredOrder(customerId: string, deliveredAt: Date) {
  return OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
    customerId,
    status: "DELIVERED",
    placedAt: new Date(deliveredAt.getTime() - 60 * 60 * 1000),
    subtotal: new Decimal("100.00"),
    total: new Decimal("100.00"),
    fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
    payment: { method: "COD", status: "NOT_REQUIRED" },
    timeline: [
      { type: "ORDER_PLACED", at: new Date(deliveredAt.getTime() - 60 * 60 * 1000), actorType: "CUSTOMER" },
      { type: "ORDER_DELIVERED", at: deliveredAt, actorType: "STAFF" },
    ],
  });
}

async function createOrderLine(orderId: mongoose.Types.ObjectId, overrides: Partial<Record<string, unknown>> = {}) {
  return OrderLineModel.create({
    orderId,
    lineNumber: 1,
    variantId: new mongoose.Types.ObjectId(),
    sku: "SKU-1",
    productName: "Product",
    variantDescription: "Default",
    quantity: 2,
    unitPrice: new Decimal("50.00"),
    lineTotal: new Decimal("100.00"),
    ...overrides,
  });
}

describe("requestReturn", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await FulfilmentSettingsModel.deleteMany({});
    await ReturnSequenceModel.deleteMany({});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await ReturnModel.deleteMany({});
    await ReturnLineModel.deleteMany({});
    await FulfilmentSettingsModel.deleteMany({});
    await ReturnSequenceModel.deleteMany({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a valid single-line return, its ReturnLine, and appends RETURN_REQUESTED to the timeline", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(customer._id, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
    const line = await createOrderLine(order._id, { quantity: 2 });

    const result = await requestReturn({
      customer,
      orderNumber: order.orderNumber,
      reason: "Changed my mind",
      lines: [{ orderLineId: line._id.toString(), quantity: 1, reason: "Too small", condition: "Unopened" }],
      now: new Date(),
    });

    expect(result.returnNumber).toMatch(/^RET-\d{6}$/);
    expect(result.status).toBe("REQUESTED");
    expect(result.lineCount).toBe(1);

    const returnLines = await ReturnLineModel.find({ returnId: result.returnId }).lean();
    expect(returnLines).toHaveLength(1);
    expect(returnLines[0]!.quantity).toBe(1);
    expect(returnLines[0]!.condition).toBe("Unopened");

    const updatedOrder = await OrderModel.findById(order._id).lean();
    expect(updatedOrder?.timeline).toHaveLength(3);
    expect(updatedOrder?.timeline[2]!.type).toBe("RETURN_REQUESTED");
    expect(updatedOrder?.timeline[2]!.actorType).toBe("CUSTOMER");
  });

  it("creates a valid multi-line return with partial and full quantities", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(customer._id, new Date());
    const lineA = await createOrderLine(order._id, { lineNumber: 1, sku: "SKU-A", quantity: 3 });
    const lineB = await createOrderLine(order._id, { lineNumber: 2, sku: "SKU-B", quantity: 1 });

    const result = await requestReturn({
      customer,
      orderNumber: order.orderNumber,
      reason: "Multiple issues",
      lines: [
        { orderLineId: lineA._id.toString(), quantity: 2, reason: "Damaged", condition: "Damaged" },
        { orderLineId: lineB._id.toString(), quantity: 1, reason: "Wrong item", condition: "Unopened" },
      ],
      now: new Date(),
    });

    expect(result.lineCount).toBe(2);
    const returnLines = await ReturnLineModel.find({ returnId: result.returnId }).lean();
    expect(returnLines).toHaveLength(2);
  });

  it("throws NotFoundError for a nonexistent order", async () => {
    const customer = customerIdentity();

    await expect(
      requestReturn({ customer, orderNumber: "ORD-999999", reason: "x", lines: [], now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the order belongs to a different customer", async () => {
    const owner = customerIdentity();
    const intruder = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(owner._id, new Date());
    const line = await createOrderLine(order._id);

    await expect(
      requestReturn({
        customer: intruder,
        orderNumber: order.orderNumber,
        reason: "x",
        lines: [{ orderLineId: line._id.toString(), quantity: 1, reason: "x", condition: "x" }],
        now: new Date(),
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when the order is not DELIVERED", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await OrderModel.create({
      orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
      idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
      customerId: customer._id,
      status: "PROCESSING",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    const line = await createOrderLine(order._id);

    await expect(
      requestReturn({
        customer,
        orderNumber: order.orderNumber,
        reason: "x",
        lines: [{ orderLineId: line._id.toString(), quantity: 1, reason: "x", condition: "x" }],
        now: new Date(),
      })
    ).rejects.toThrow(ConflictError);
  });

  it("treats a DELIVERED order with no ORDER_DELIVERED timeline entry as not eligible, per the existing eligibility contract", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    // Status says DELIVERED but the timeline never recorded it (data-integrity edge case).
    const order = await OrderModel.create({
      orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
      idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
      customerId: customer._id,
      status: "DELIVERED",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
      timeline: [],
    });
    const line = await createOrderLine(order._id);

    await expect(
      requestReturn({
        customer,
        orderNumber: order.orderNumber,
        reason: "x",
        lines: [{ orderLineId: line._id.toString(), quantity: 1, reason: "x", condition: "x" }],
        now: new Date(),
      })
    ).rejects.toThrow(ConflictError);
  });

  it("throws ConflictError when the return window has expired", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings(14);
    const deliveredAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
    const order = await createDeliveredOrder(customer._id, deliveredAt);
    const line = await createOrderLine(order._id);

    await expect(
      requestReturn({
        customer,
        orderNumber: order.orderNumber,
        reason: "x",
        lines: [{ orderLineId: line._id.toString(), quantity: 1, reason: "x", condition: "x" }],
        now: new Date(),
      })
    ).rejects.toThrow(ConflictError);
  });

  it("throws NotFoundError when the orderLineId does not belong to this order, without leaking whether it exists elsewhere", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(customer._id, new Date());
    await createOrderLine(order._id);

    const foreignLineId = new mongoose.Types.ObjectId().toString();

    await expect(
      requestReturn({
        customer,
        orderNumber: order.orderNumber,
        reason: "x",
        lines: [{ orderLineId: foreignLineId, quantity: 1, reason: "x", condition: "x" }],
        now: new Date(),
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when the requested quantity exceeds what was purchased", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(customer._id, new Date());
    const line = await createOrderLine(order._id, { quantity: 2 });

    await expect(
      requestReturn({
        customer,
        orderNumber: order.orderNumber,
        reason: "x",
        lines: [{ orderLineId: line._id.toString(), quantity: 3, reason: "x", condition: "x" }],
        now: new Date(),
      })
    ).rejects.toThrow(ConflictError);
  });

  it("throws ConflictError when the line has already been fully returned by a prior REQUESTED return", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(customer._id, new Date());
    const line = await createOrderLine(order._id, { quantity: 2 });

    await requestReturn({
      customer,
      orderNumber: order.orderNumber,
      reason: "First request",
      lines: [{ orderLineId: line._id.toString(), quantity: 2, reason: "x", condition: "x" }],
      now: new Date(),
    });

    await expect(
      requestReturn({
        customer,
        orderNumber: order.orderNumber,
        reason: "Second request",
        lines: [{ orderLineId: line._id.toString(), quantity: 1, reason: "x", condition: "x" }],
        now: new Date(),
      })
    ).rejects.toThrow(ConflictError);
  });

  it("a prior REJECTED return does not consume remaining quantity", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(customer._id, new Date());
    const line = await createOrderLine(order._id, { quantity: 2 });

    const firstReturn = await ReturnModel.create({
      orderId: order._id,
      customerId: customer._id,
      returnNumber: "RET-100001",
      reason: "First",
      status: "REJECTED",
      requestedAt: new Date(),
    });
    await ReturnLineModel.create({
      returnId: firstReturn._id,
      orderLineId: line._id,
      quantity: 2,
      reason: "x",
      condition: "x",
    });

    const result = await requestReturn({
      customer,
      orderNumber: order.orderNumber,
      reason: "Second request",
      lines: [{ orderLineId: line._id.toString(), quantity: 2, reason: "x", condition: "x" }],
      now: new Date(),
    });

    expect(result.status).toBe("REQUESTED");
  });

  it("a prior APPROVED return does consume remaining quantity", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(customer._id, new Date());
    const line = await createOrderLine(order._id, { quantity: 2 });

    const approvedReturn = await ReturnModel.create({
      orderId: order._id,
      customerId: customer._id,
      returnNumber: "RET-100002",
      reason: "First",
      status: "APPROVED",
      requestedAt: new Date(),
    });
    await ReturnLineModel.create({
      returnId: approvedReturn._id,
      orderLineId: line._id,
      quantity: 2,
      reason: "x",
      condition: "x",
    });

    await expect(
      requestReturn({
        customer,
        orderNumber: order.orderNumber,
        reason: "Second request",
        lines: [{ orderLineId: line._id.toString(), quantity: 1, reason: "x", condition: "x" }],
        now: new Date(),
      })
    ).rejects.toThrow(ConflictError);
  });

  it("allows multiple separate return requests for the same order when remaining quantity permits", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(customer._id, new Date());
    const line = await createOrderLine(order._id, { quantity: 4 });

    const first = await requestReturn({
      customer,
      orderNumber: order.orderNumber,
      reason: "First",
      lines: [{ orderLineId: line._id.toString(), quantity: 2, reason: "x", condition: "x" }],
      now: new Date(),
    });

    const second = await requestReturn({
      customer,
      orderNumber: order.orderNumber,
      reason: "Second",
      lines: [{ orderLineId: line._id.toString(), quantity: 2, reason: "x", condition: "x" }],
      now: new Date(),
    });

    expect(first.returnId).not.toBe(second.returnId);
    expect(await ReturnModel.countDocuments({ orderId: order._id })).toBe(2);
  });

  it("leaves no orphaned Return, ReturnLine, or timeline mutation when the transaction fails, and does not burn a return number", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const order = await createDeliveredOrder(customer._id, new Date());
    const line = await createOrderLine(order._id, { quantity: 2 });

    const createSpy = vi.spyOn(returnLineRepository, "save").mockRejectedValueOnce(new Error("simulated DB failure"));

    await expect(
      requestReturn({
        customer,
        orderNumber: order.orderNumber,
        reason: "x",
        lines: [{ orderLineId: line._id.toString(), quantity: 1, reason: "x", condition: "x" }],
        now: new Date(),
      })
    ).rejects.toThrow();

    createSpy.mockRestore();

    expect(await ReturnModel.countDocuments({ orderId: order._id })).toBe(0);
    expect(await ReturnLineModel.countDocuments({})).toBe(0);
    const unchangedOrder = await OrderModel.findById(order._id).lean();
    expect(unchangedOrder?.timeline).toHaveLength(2); // ORDER_PLACED + ORDER_DELIVERED only

    // The failed attempt's return-number allocation rolled back with it —
    // the next successful attempt gets the first number, not the second.
    const result = await requestReturn({
      customer,
      orderNumber: order.orderNumber,
      reason: "retry",
      lines: [{ orderLineId: line._id.toString(), quantity: 1, reason: "x", condition: "x" }],
      now: new Date(),
    });
    expect(result.returnNumber).toBe("RET-000001");
  });
});
