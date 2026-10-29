// @vitest-environment node
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { buildCartLineIdentityKey, CartLineModel } from "../../commerce/cart-line.schema";
import { CartModel } from "../../commerce/cart.schema";
import { OrderLineModel, OrderModel } from "../../commerce/order.schema";
import { OrderSequenceModel } from "../../commerce/order-sequence.schema";
import { connectToDatabase } from "../../core/db/connect";
import { DeliveryZoneModel } from "../../fulfilment/delivery-zone.schema";
import { placeOrder } from "./place-order";
import type { PlaceOrderInput } from "./place-order.types";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
  // Another suite may have left orders behind; a stale ORD-000001 would collide with this one's first order.
  await Promise.all([OrderModel.deleteMany({}), OrderLineModel.deleteMany({}), OrderSequenceModel.deleteMany({})]);
});

afterEach(async () => {
  await Promise.all([
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    VariantModel.deleteMany({}),
    CartModel.deleteMany({}),
    CartLineModel.deleteMany({}),
    OrderModel.deleteMany({}),
    OrderLineModel.deleteMany({}),
    OrderSequenceModel.deleteMany({}),
    DeliveryZoneModel.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function seed() {
  const category = await CategoryModel.create({ slug: "electronics" });
  const product = await ProductModel.create({
    slug: `p-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "T", ar: "ت" },
  });
  const variant = await VariantModel.create({
    productId: product._id,
    sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
    variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    price: toMoney("100.00"),
    stock: 10,
  });
  const cart = await CartModel.create({});
  await CartLineModel.create({
    cartId: cart._id,
    variantId: variant._id,
    quantity: 1,
    lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined),
  });
  const zone = await DeliveryZoneModel.create({
    name: { en: "Cairo", ar: "القاهرة" },
    areas: ["Maadi"],
    fee: toMoney("25.00"),
    minimumOrder: toMoney("0.00"),
    leadDays: 2,
  });
  return { cart, zone };
}

function baseInput(cartId: mongoose.Types.ObjectId, zoneName: string, zoneId: string): PlaceOrderInput {
  return {
    cartId,
    idempotencyKey: `k-${new mongoose.Types.ObjectId().toString()}`,
    termsVersionAccepted: 1,
    guestContact: { name: "Test Customer", phone: "+201000000000" },
    fulfilment: {
      mode: "DELIVERY",
      addressSnapshot: { recipientName: "Test Customer", phone: "+201000000000", addressLine1: "1 Test St", city: "Cairo", governorate: "Cairo" },
      zoneName,
    },
    paymentMethod: "COD",
    requiresPaymentProof: false,
    requiresProviderIntegration: false,
    now: new Date(2026, 7, 28, 10, 0),
    tax: { mode: "ADDED", rate: 0 },
    shippingSettings: {
      // This is the real Phase 4B wiring point: a route builds `zones[]`
      // from real `DeliveryZoneModel` documents, mapping `_id` into `zoneId`.
      zones: [{ zone: zoneName, zoneId, fee: toMoney("25.00"), estimatedDays: 2, minimumOrder: toMoney("0.00") }],
      deliveryEnabled: true,
      pickupEnabled: true,
      shippingFeeMode: "BY_ZONE",
      defaultDispatchLeadDays: 1,
      timeZone: "Africa/Cairo",
      operatingHours: { weekly: [], exceptions: [] },
      maxDaysAhead: 14,
      customerCancelWindowMinutes: 30,
    },
    locale: "en",
  };
}

describe("Order.fulfilment.zoneId — resolved and snapshotted, alongside the existing historical snapshot", () => {
  it("persists zoneId AND the full historical snapshot (zone name, fee, dispatchBy, promisedWindow) on the same order", async () => {
    const { cart, zone } = await seed();

    const result = await placeOrder(baseInput(cart._id, "cairo", zone._id.toString()));

    const order = await OrderModel.findById(result.orderId).lean();
    expect(order?.fulfilment.zoneId?.toString()).toBe(zone._id.toString());
    expect(order?.fulfilment.zone).toBe("cairo");
    expect(order?.fulfilment.fee.toString()).toBe("25.00");
    expect(order?.fulfilment.dispatchBy).toBeInstanceOf(Date);
    expect(order?.fulfilment.promisedWindow?.from).toBeInstanceOf(Date);
    expect(order?.fulfilment.promisedWindow?.to).toBeInstanceOf(Date);
  });

  it("a later change to the DeliveryZone document does not alter the already-placed order's snapshot", async () => {
    const { cart, zone } = await seed();
    const result = await placeOrder(baseInput(cart._id, "cairo", zone._id.toString()));

    await DeliveryZoneModel.updateOne({ _id: zone._id }, { $set: { fee: toMoney("999.00"), "name.en": "Renamed Zone" } });

    const order = await OrderModel.findById(result.orderId).lean();
    expect(order?.fulfilment.fee.toString()).toBe("25.00"); // unchanged — the snapshot, not a live read
    expect(order?.fulfilment.zone).toBe("cairo"); // the snapshot name, not "Renamed Zone"
    expect(order?.fulfilment.zoneId?.toString()).toBe(zone._id.toString()); // the reference still points at the (now-renamed) zone — informational, not authoritative
  });

  it("a soft-deleted DeliveryZone still leaves its id on historical orders — the reference is informational, not a live constraint", async () => {
    const { cart, zone } = await seed();
    const result = await placeOrder(baseInput(cart._id, "cairo", zone._id.toString()));

    await DeliveryZoneModel.updateOne({ _id: zone._id }, { $set: { deletedAt: new Date() } });

    const order = await OrderModel.findById(result.orderId).lean();
    expect(order?.fulfilment.zoneId?.toString()).toBe(zone._id.toString());
    expect(order?.fulfilment.fee.toString()).toBe("25.00"); // still the placed-at-the-time fee
  });

  it("PICKUP orders have no zoneId — a pickup fulfilment has no zone concept at all", async () => {
    const { cart } = await seed();
    const input = baseInput(cart._id, "cairo", "unused");
    input.fulfilment = { mode: "PICKUP", pickupLocationSnapshot: { name: "Main Branch", address: "1 Store St", phone: "+201000000000" } };

    const result = await placeOrder(input);

    const order = await OrderModel.findById(result.orderId).lean();
    expect(order?.fulfilment.zoneId).toBeUndefined();
  });
});
