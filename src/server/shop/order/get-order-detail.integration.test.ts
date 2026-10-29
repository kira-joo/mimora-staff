import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { getOrderDetail } from "./get-order-detail";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { FulfilmentSettingsModel } from "../../fulfilment/fulfilment-settings.schema";
import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

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

describe("getOrderDetail", () => {
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
    await FulfilmentSettingsModel.deleteMany({});
  });

  it("returns full order detail with lines for valid order", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();

    const order = await OrderModel.create({
      orderNumber: "ORD-006001",
      idempotencyKey: "ORD-006001",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("150.00"),
      discount: new Decimal("10.00"),
      tax: new Decimal("5.00"),
      total: new Decimal("145.00"),
      fulfilment: {
        mode: "DELIVERY",
        fee: new Decimal("5.00"),
        zone: "Zone A",
        addressSnapshot: {
          recipientName: "Jane Doe",
          phone: "555-0300",
          addressLine1: "789 Oak St",
          city: "City",
          governorate: "Gov",
        },
      },
      payment: { method: "TRANSFER", status: "AWAITING_PAYMENT" },
    });

    await OrderLineModel.create([
      {
        orderId: order._id,
        lineNumber: 1,
        variantId: new mongoose.Types.ObjectId(),
        sku: "SKU-A",
        productName: "Product A",
        variantDescription: "Size M",
        quantity: 2,
        unitPrice: new Decimal("50.00"),
        lineTotal: new Decimal("100.00"),
      },
      {
        orderId: order._id,
        lineNumber: 2,
        variantId: new mongoose.Types.ObjectId(),
        sku: "SKU-B",
        productName: "Product B",
        variantDescription: "Default",
        quantity: 1,
        unitPrice: new Decimal("50.00"),
        lineTotal: new Decimal("50.00"),
      },
    ]);

    const result = await getOrderDetail({ customer, orderNumber: "ORD-006001", now: new Date() });

    expect(result.orderNumber).toBe("ORD-006001");
    expect(result.status).toBe("PLACED");
    expect(result.paymentStatus).toBe("AWAITING_PAYMENT");
    expect(result.subtotal.toFixed(2)).toBe("150.00");
    expect(result.discount.toFixed(2)).toBe("10.00");
    expect(result.tax.toFixed(2)).toBe("5.00");
    expect(result.total.toFixed(2)).toBe("145.00");

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].lineNumber).toBe(1);
    expect(result.lines[0].sku).toBe("SKU-A");
    expect(result.lines[0].productName).toBe("Product A");
    expect(result.lines[0].variantDescription).toBe("Size M");
    expect(result.lines[0].quantity).toBe(2);

    expect(result.fulfilment.mode).toBe("DELIVERY");
    expect(result.fulfilment.fee.toFixed(2)).toBe("5.00");
    expect(result.fulfilment.addressSnapshot?.recipientName).toBe("Jane Doe");

    expect(result.payment.method).toBe("TRANSFER");
    expect(result.payment.status).toBe("AWAITING_PAYMENT");
  });

  it("names each line by its own id and the product bought — snapshotted, or resolved through the variant for older lines", async () => {
    await createFulfilmentSettings();
    const customer = customerIdentity();
    const order = await OrderModel.create({
      orderNumber: "ORD-LINEIDS",
      idempotencyKey: "ORD-LINEIDS",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("30.00"),
      discount: new Decimal("0"),
      tax: new Decimal("0"),
      total: new Decimal("30.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Shop", address: "Street", phone: "0100" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    const snapshotProduct = new mongoose.Types.ObjectId();
    const legacyProduct = new mongoose.Types.ObjectId();
    const legacyVariant = new mongoose.Types.ObjectId();
    // A pre-2026-10-20 line has no productId; its variant still knows its product.
    await VariantModel.collection.insertOne({ _id: legacyVariant, productId: legacyProduct });
    const [snapshotted, legacy] = await OrderLineModel.create([
      { orderId: order._id, lineNumber: 1, variantId: new mongoose.Types.ObjectId(), productId: snapshotProduct, sku: "S-1", productName: "One", variantDescription: "One", quantity: 1, unitPrice: new Decimal("10.00"), lineTotal: new Decimal("10.00") },
      { orderId: order._id, lineNumber: 2, variantId: legacyVariant, sku: "S-2", productName: "Two", variantDescription: "Two", quantity: 2, unitPrice: new Decimal("10.00"), lineTotal: new Decimal("20.00") },
    ]);

    const result = await getOrderDetail({ customer, orderNumber: "ORD-LINEIDS", now: new Date() });

    expect(result.lines[0]).toMatchObject({ orderLineId: snapshotted!._id.toString(), productId: snapshotProduct.toString() });
    expect(result.lines[1]).toMatchObject({ orderLineId: legacy!._id.toString(), productId: legacyProduct.toString() });
  });

  it("throws NotFoundError when order does not exist", async () => {
    const customer = customerIdentity();

    await expect(
      getOrderDetail({ customer, orderNumber: "ORD-009999", now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when order belongs to different customer", async () => {
    const customer1 = customerIdentity();
    const customer2 = customerIdentity();

    await OrderModel.create({
      orderNumber: "ORD-006002",
      idempotencyKey: "ORD-006002",
      customerId: customer1._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    await expect(
      getOrderDetail({ customer: customer2, orderNumber: "ORD-006002", now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("derives canCancel=true when within cancellation window", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();

    const now = new Date();
    const placedAt = new Date(now.getTime() - 15 * 60 * 1000); // 15 minutes ago

    await OrderModel.create({
      orderNumber: "ORD-006003",
      idempotencyKey: "ORD-006003",
      customerId: customer._id,
      status: "PLACED",
      placedAt,
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const result = await getOrderDetail({ customer, orderNumber: "ORD-006003", now });

    expect(result.canCancel).toBe(true);
  });

  it("derives canCancel=false when outside cancellation window", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();

    const now = new Date();
    const placedAt = new Date(now.getTime() - 45 * 60 * 1000); // 45 minutes ago

    await OrderModel.create({
      orderNumber: "ORD-006004",
      idempotencyKey: "ORD-006004",
      customerId: customer._id,
      status: "PLACED",
      placedAt,
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const result = await getOrderDetail({ customer, orderNumber: "ORD-006004", now });

    expect(result.canCancel).toBe(false);
  });

  it("derives canCancel=false when order is already terminal, even within the time window", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();

    const now = new Date();
    const placedAt = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes ago, within window

    await OrderModel.create({
      orderNumber: "ORD-006005",
      idempotencyKey: "ORD-006005",
      customerId: customer._id,
      status: "DELIVERED",
      placedAt,
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const result = await getOrderDetail({ customer, orderNumber: "ORD-006005", now });

    expect(result.canCancel).toBe(false);
  });

  it("uses default 30 minute cancel window when settings are missing", async () => {
    const customer = customerIdentity();

    const now = new Date();
    const placedAt = new Date(now.getTime() - 20 * 60 * 1000); // 20 minutes ago

    await OrderModel.create({
      orderNumber: "ORD-006006",
      idempotencyKey: "ORD-006006",
      customerId: customer._id,
      status: "PLACED",
      placedAt,
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });

    const result = await getOrderDetail({ customer, orderNumber: "ORD-006006", now });

    expect(result.canCancel).toBe(true);
  });
});
