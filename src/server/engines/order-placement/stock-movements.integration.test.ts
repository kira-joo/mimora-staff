// @vitest-environment node
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { StockMovementModel } from "../../catalog/stock-movement.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { buildCartLineIdentityKey, CartLineModel } from "../../commerce/cart-line.schema";
import { CartModel } from "../../commerce/cart.schema";
import { OrderLineModel, OrderModel } from "../../commerce/order.schema";
import { OrderSequenceModel } from "../../commerce/order-sequence.schema";
import { connectToDatabase } from "../../core/db/connect";
import { orderLineRepository } from "../../core/repositories";
import { cancelOrder } from "../../shop/order/cancel-order";
import { placeOrder } from "./place-order";
import type { PlaceOrderInput } from "./place-order.types";
import { releaseStock } from "./reserve-stock";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
  // Another suite may have left orders behind; a stale ORD-000001 would collide with this one's first order.
  await Promise.all([OrderModel.deleteMany({}), OrderLineModel.deleteMany({}), OrderSequenceModel.deleteMany({})]);
  // Other suites place orders in this database and leave their sale movements behind.
  await StockMovementModel.deleteMany({});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    VariantModel.deleteMany({}),
    CartModel.deleteMany({}),
    CartLineModel.deleteMany({}),
    OrderModel.deleteMany({}),
    OrderLineModel.deleteMany({}),
    OrderSequenceModel.deleteMany({}),
    StockMovementModel.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

const SHIPPING = {
  zones: [{ zone: "cairo", fee: toMoney("20.00"), estimatedDays: 2, minimumOrder: toMoney("0.00") }],
  deliveryEnabled: true,
  pickupEnabled: true,
  defaultDispatchLeadDays: 1,
  shippingFeeMode: "BY_ZONE" as const,
  timeZone: "Africa/Cairo",
  operatingHours: { weekly: [], exceptions: [] },
  maxDaysAhead: 14,
  customerCancelWindowMinutes: 30,
};

async function seedVariant(stock: number, backorderPolicy: "DENY" | "CONTINUE_SELLING" = "DENY") {
  const category = await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId().toString()}` });
  const product = await ProductModel.create({
    slug: `product-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "Test Product", ar: "منتج تجريبي" },
  });
  return VariantModel.create({
    productId: product._id,
    sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
    variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    price: toMoney("100.00"),
    stock,
    backorderPolicy,
  });
}

async function seedCart(lines: Array<{ variant: { _id: mongoose.Types.ObjectId }; quantity: number }>) {
  const cart = await CartModel.create({});
  for (const line of lines) {
    await CartLineModel.create({ cartId: cart._id, variantId: line.variant._id, quantity: line.quantity, lineIdentityKey: buildCartLineIdentityKey(cart._id, line.variant._id, undefined) });
  }
  return cart;
}

function input(cartId: mongoose.Types.ObjectId, overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    cartId,
    idempotencyKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    termsVersionAccepted: 1,
    guestContact: { name: "Guest", phone: "+201000000000" },
    fulfilment: {
      mode: "DELIVERY",
      addressSnapshot: { recipientName: "Guest", phone: "+201000000000", addressLine1: "1 Test St", city: "Cairo", governorate: "Cairo" },
      zoneName: "cairo",
    },
    paymentMethod: "COD",
    requiresPaymentProof: false,
    requiresProviderIntegration: false,
    now: new Date("2026-08-28T07:00:00Z"),
    tax: { mode: "ADDED", rate: 0 },
    shippingSettings: SHIPPING,
    locale: "en",
    ...overrides,
  };
}

describe("placement writes a SALE movement per decremented variant", () => {
  it("one negative row per variant, tied to the order, in the placement transaction", async () => {
    const a = await seedVariant(10);
    const b = await seedVariant(5);
    const cart = await seedCart([
      { variant: a, quantity: 3 },
      { variant: b, quantity: 2 },
    ]);
    const customerId = new mongoose.Types.ObjectId();

    const result = await placeOrder(input(cart._id, { customerId, guestContact: undefined }));

    const movements = await StockMovementModel.find({}).lean();
    expect(movements).toHaveLength(2);
    const byVariant = new Map(movements.map((movement) => [movement.variantId.toString(), movement]));
    expect(byVariant.get(a._id.toString())).toMatchObject({ delta: -3, reason: "SALE" });
    expect(byVariant.get(b._id.toString())).toMatchObject({ delta: -2, reason: "SALE" });
    for (const movement of movements) {
      expect(movement.orderId?.toString()).toBe(result.orderId.toString());
      expect(movement.actorId?.toString()).toBe(customerId.toString());
    }
    // The log adds up to the stock: 10 - 3 and 5 - 2.
    expect((await VariantModel.findById(a._id).lean())?.stock).toBe(7);
    expect((await VariantModel.findById(b._id).lean())?.stock).toBe(3);
  });

  it("a guest's sale carries no actor rather than an invented one", async () => {
    const variant = await seedVariant(10);
    const cart = await seedCart([{ variant, quantity: 1 }]);

    await placeOrder(input(cart._id));

    const movement = await StockMovementModel.findOne({}).lean();
    expect(movement?.reason).toBe("SALE");
    expect(movement?.actorId).toBeUndefined();
  });

  it("two lines for one variant are one movement for the summed quantity", async () => {
    const variant = await seedVariant(10);
    const cart = await CartModel.create({});
    // Two lines naming one variant — distinct identity keys, as a cart merge would not normally produce.
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 2, lineIdentityKey: "a" });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 3, lineIdentityKey: "b" });

    await placeOrder(input(cart._id));

    const movements = await StockMovementModel.find({}).lean();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ delta: -5, reason: "SALE" });
  });

  it("a CONTINUE_SELLING variant sold past zero still records the sale", async () => {
    const variant = await seedVariant(1, "CONTINUE_SELLING");
    const cart = await seedCart([{ variant, quantity: 4 }]);

    await placeOrder(input(cart._id));

    expect(await StockMovementModel.findOne({ variantId: variant._id }).lean()).toMatchObject({ delta: -4, reason: "SALE" });
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(-3);
  });

  it("ROLLBACK: a failure after the movements are written leaves no movement, no order and the stock untouched", async () => {
    const variant = await seedVariant(10);
    const cart = await seedCart([{ variant, quantity: 3 }]);
    // `orderLineRepository.save` runs after the decrement and the movement writes — failing it AFTER it writes
    // proves they are undone, where failing before any write would prove nothing.
    const original = orderLineRepository.save.bind(orderLineRepository);
    vi.spyOn(orderLineRepository, "save").mockImplementation((async (...args: Parameters<typeof original>) => {
      await original(...args);
      throw new Error("injected failure");
    }) as typeof original);

    await expect(placeOrder(input(cart._id))).rejects.toThrow("injected failure");

    expect(await StockMovementModel.countDocuments({})).toBe(0);
    expect(await OrderModel.countDocuments({})).toBe(0);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(10);
  });

  it("a refused oversell writes no movement", async () => {
    const variant = await seedVariant(1);
    const cart = await seedCart([{ variant, quantity: 2 }]);

    await expect(placeOrder(input(cart._id))).rejects.toThrow();

    expect(await StockMovementModel.countDocuments({})).toBe(0);
  });
});

describe("releasing stock writes a RETURN movement", () => {
  it("restores the units and records one positive row per variant, attributed when a context is given", async () => {
    const variant = await seedVariant(7);
    const orderId = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();

    await releaseStock([{ variantId: variant._id, quantity: 3, backorderPolicy: "DENY" }], { orderId, actorId, at: new Date("2026-08-28T08:00:00Z") });

    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(10);
    const movement = await StockMovementModel.findOne({}).lean();
    expect(movement).toMatchObject({ delta: 3, reason: "RETURN" });
    expect(movement?.orderId?.toString()).toBe(orderId.toString());
    expect(movement?.actorId?.toString()).toBe(actorId.toString());
    expect(movement?.note).toMatch(/cancel/i);
  });

  it("still records the movement for a caller that passes no context", async () => {
    const variant = await seedVariant(0);

    await releaseStock([{ variantId: variant._id, quantity: 2, backorderPolicy: "DENY" }]);

    expect(await StockMovementModel.findOne({ variantId: variant._id }).lean()).toMatchObject({ delta: 2, reason: "RETURN" });
  });

  it("a customer cancelling an order leaves the sale and its reversal in the log, netting to zero", async () => {
    const variant = await seedVariant(10);
    const cart = await seedCart([{ variant, quantity: 4 }]);
    const customerId = new mongoose.Types.ObjectId();
    const placedAt = new Date("2026-08-28T07:00:00Z");
    const result = await placeOrder(input(cart._id, { customerId, guestContact: undefined, now: placedAt }));

    await cancelOrder({ customer: { _id: customerId.toString(), name: "C", phone: "+201000000000" }, orderNumber: result.orderNumber, now: new Date(placedAt.getTime() + 5 * 60_000) });

    const movements = await StockMovementModel.find({ variantId: variant._id }).sort({ delta: 1 }).lean();
    expect(movements.map((movement) => [movement.reason, movement.delta])).toEqual([
      ["SALE", -4],
      ["RETURN", 4],
    ]);
    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(10);
  });
});

describe("Order.customerCancelUntil", () => {
  it("is placedAt plus the configured window", async () => {
    const variant = await seedVariant(10);
    const cart = await seedCart([{ variant, quantity: 1 }]);
    const now = new Date("2026-08-28T07:00:00Z");

    const result = await placeOrder(input(cart._id, { now, shippingSettings: { ...SHIPPING, customerCancelWindowMinutes: 45 } }));

    const order = await OrderModel.findById(result.orderId).lean();
    expect(order?.customerCancelUntil?.toISOString()).toBe("2026-08-28T07:45:00.000Z");
  });

  it("follows the merchant's window, not a constant", async () => {
    const variant = await seedVariant(10);
    const cart = await seedCart([{ variant, quantity: 1 }]);
    const now = new Date("2026-08-28T07:00:00Z");

    const result = await placeOrder(input(cart._id, { now, shippingSettings: { ...SHIPPING, customerCancelWindowMinutes: 0 } }));

    expect((await OrderModel.findById(result.orderId).lean())?.customerCancelUntil?.toISOString()).toBe(now.toISOString());
  });
});

describe("operating hours and the store zone reach the order", () => {
  it("snapshots a dispatch day that skips the closed weekend, in the store's zone", async () => {
    const variant = await seedVariant(10);
    const cart = await seedCart([{ variant, quantity: 1 }]);
    const sunThu = { weekly: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, ranges: [{ open: "09:00", close: "17:00" }] })), exceptions: [] };

    // Thursday 27 August 2026, 10:00 in Cairo (UTC+3); lead 1 would land on closed Friday.
    const result = await placeOrder(input(cart._id, { now: new Date("2026-08-27T07:00:00Z"), shippingSettings: { ...SHIPPING, operatingHours: sunThu } }));

    const order = await OrderModel.findById(result.orderId).lean();
    // Sunday 30 August 00:00 in Cairo is Saturday 29 August 21:00 UTC.
    expect(order?.fulfilment.dispatchBy?.toISOString()).toBe("2026-08-29T21:00:00.000Z");
  });
});
