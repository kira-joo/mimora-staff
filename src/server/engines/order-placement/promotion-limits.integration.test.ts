import { ConflictError, ServiceUnavailableError } from "@kira-joo/backend-toolkit-core";
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
import { PromotionModel } from "../../commerce/promotion.schema";
import { connectToDatabase } from "../../core/db/connect";
import { placeOrder } from "./place-order";
import type { PlaceOrderInput } from "./place-order.types";

/*
 * Per-customer and global promotion limits, and placement under contention (2026-10-21).
 *
 * Before: `customerUses` was always 0 (per-customer limits never held) and the first-order
 * count was read BEFORE the placement transaction (racing first orders could both claim a
 * first-order promotion). And a burst of concurrent orders could exhaust the transaction's
 * retry budget (immediate retries) as a 503. The global cap already held under concurrency
 * — the in-transaction increment write-conflicts — and is pinned here so it keeps holding.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
  // Another suite may have left orders behind; a stale ORD-000001 would collide with this one's first order.
  await Promise.all([OrderModel.deleteMany({}), OrderLineModel.deleteMany({}), OrderSequenceModel.deleteMany({})]);
});

afterEach(async () => {
  for (const model of [CategoryModel, ProductModel, VariantModel, CartModel, CartLineModel, OrderModel, OrderLineModel, OrderSequenceModel, PromotionModel] as const) {
    await (model as mongoose.Model<unknown>).deleteMany({});
  }
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

async function variant(stock = 50) {
  const category = await CategoryModel.findOneAndUpdate({ slug: "kitchen" }, { slug: "kitchen" }, { upsert: true, new: true });
  const product = await ProductModel.create({
    slug: `product-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "Kettle", ar: "غلاية" },
  });
  return VariantModel.create({
    productId: product._id,
    sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
    variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    price: toMoney("100.00"),
    stock,
    backorderPolicy: "DENY",
  });
}

async function cartWith(variantId: mongoose.Types.ObjectId, quantity = 1, code?: string) {
  const cart = await CartModel.create(code ? { appliedPromotionCode: code } : {});
  await CartLineModel.create({ cartId: cart._id, variantId, quantity, lineIdentityKey: buildCartLineIdentityKey(cart._id, variantId, undefined) });
  return cart;
}

function input(cartId: mongoose.Types.ObjectId, who: { customerId?: mongoose.Types.ObjectId } = {}): PlaceOrderInput {
  return {
    cartId,
    idempotencyKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    termsVersionAccepted: 1,
    ...(who.customerId ? { customerId: who.customerId } : { guestContact: { name: "Guest", phone: "+201000000000" } }),
    fulfilment: {
      mode: "DELIVERY",
      addressSnapshot: { recipientName: "A", phone: "+201000000000", addressLine1: "1 St", city: "Cairo", governorate: "Cairo" },
      zoneName: "cairo",
    },
    paymentMethod: "COD",
    requiresPaymentProof: false,
    requiresProviderIntegration: false,
    now: new Date(2026, 9, 21, 10, 0),
    tax: { mode: "ADDED", rate: 0 },
    shippingSettings: SHIPPING,
    locale: "en",
  };
}

async function promotion(code: string, limits: { totalUses?: number; perCustomerUses?: number } = {}, conditions: Record<string, unknown> = {}) {
  return PromotionModel.create({
    code,
    name: { en: code, ar: code },
    description: { en: "x", ar: "x" },
    type: "PERCENT",
    value: toMoney("10"),
    limits,
    conditions,
  });
}

const discounted = (result: { discount: { toFixed(n: number): string } }) => result.discount.toFixed(2) !== "0.00";

describe("per-customer promotion limits", () => {
  it("allows a customer exactly perCustomerUses orders with the code, and snapshots the code on the lines", async () => {
    const v = await variant();
    const promo = await promotion("ONCE", { perCustomerUses: 1 });
    const customerId = new mongoose.Types.ObjectId();

    const first = await placeOrder(input((await cartWith(v._id, 1, "ONCE"))._id, { customerId }));
    const second = await placeOrder(input((await cartWith(v._id, 1, "ONCE"))._id, { customerId }));

    expect(first.discount.toFixed(2)).toBe("10.00");
    expect(second.discount.toFixed(2)).toBe("0.00");
    expect((await OrderLineModel.find({ orderId: first.orderId }).lean()).map((line) => line.promotionCode)).toEqual(["ONCE"]);
    expect((await OrderLineModel.find({ orderId: second.orderId }).lean()).map((line) => line.promotionCode)).toEqual([undefined]);
    expect((await PromotionModel.findById(promo._id).lean())!.usageCount).toBe(1);
  });

  it("counts each customer separately", async () => {
    const v = await variant();
    await promotion("ONCE", { perCustomerUses: 1 });
    const results = [];
    for (const customerId of [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()]) {
      results.push(await placeOrder(input((await cartWith(v._id, 1, "ONCE"))._id, { customerId })));
    }
    expect(results.map(discounted)).toEqual([true, true]);
  });

  it("gives a use back when the order that used it is cancelled", async () => {
    const v = await variant();
    await promotion("ONCE", { perCustomerUses: 1 });
    const customerId = new mongoose.Types.ObjectId();
    const first = await placeOrder(input((await cartWith(v._id, 1, "ONCE"))._id, { customerId }));
    await OrderModel.updateOne({ _id: first.orderId }, { $set: { status: "CANCELLED" } });

    const again = await placeOrder(input((await cartWith(v._id, 1, "ONCE"))._id, { customerId }));
    expect(discounted(again)).toBe(true);
  });

  it("never grants a per-customer-limited promotion to a guest (a guest's uses cannot be counted), but does grant an unlimited one", async () => {
    const v = await variant();
    await promotion("ONCE", { perCustomerUses: 1 });
    await promotion("ANYONE");
    expect(discounted(await placeOrder(input((await cartWith(v._id, 1, "ONCE"))._id)))).toBe(false);
    expect(discounted(await placeOrder(input((await cartWith(v._id, 1, "ANYONE"))._id)))).toBe(true);
  });

  it("CONCURRENT: the same customer racing two orders gets the one-use promotion exactly once", async () => {
    for (let round = 0; round < 5; round++) {
      const v = await variant();
      const code = `RACE${round}`;
      const promo = await promotion(code, { perCustomerUses: 1 });
      const customerId = new mongoose.Types.ObjectId();
      const carts = [await cartWith(v._id, 1, code), await cartWith(v._id, 1, code)];

      const results = await Promise.all(carts.map((cart) => placeOrder(input(cart._id, { customerId }))));

      expect(results.filter(discounted)).toHaveLength(1);
      expect((await PromotionModel.findById(promo._id).lean())!.usageCount).toBe(1);
    }
  });

  it("CONCURRENT: a first-order promotion is granted to one of a customer's racing first orders only", async () => {
    const v = await variant();
    await promotion("WELCOME", {}, { firstOrderOnly: true });
    const customerId = new mongoose.Types.ObjectId();
    const carts = [await cartWith(v._id, 1, "WELCOME"), await cartWith(v._id, 1, "WELCOME")];

    const results = await Promise.all(carts.map((cart) => placeOrder(input(cart._id, { customerId }))));

    expect(results.filter(discounted)).toHaveLength(1);
  });
});

describe("global promotion cap", () => {
  it("CONCURRENT: five customers racing for two uses — exactly two discounts, usageCount never exceeds the cap", async () => {
    const v = await variant();
    const promo = await promotion("TWO", { totalUses: 2 });
    const carts = [];
    for (let i = 0; i < 5; i++) carts.push(await cartWith(v._id, 1, "TWO"));

    const results = await Promise.all(carts.map((cart) => placeOrder(input(cart._id, { customerId: new mongoose.Types.ObjectId() }))));

    expect(results).toHaveLength(5); // the promotion running out never fails an order
    expect(results.filter(discounted)).toHaveLength(2);
    expect((await PromotionModel.findById(promo._id).lean())!.usageCount).toBe(2);
  });
});

describe("placement under contention (the 503)", () => {
  it("eight buyers, five units of one variant: five orders, three clean stock conflicts, never a 503, no oversell", async () => {
    for (let round = 0; round < 3; round++) {
      const v = await variant(5);
      const carts = [];
      for (let i = 0; i < 8; i++) carts.push(await cartWith(v._id, 1));

      const settled = await Promise.allSettled(carts.map((cart) => placeOrder(input(cart._id, { customerId: new mongoose.Types.ObjectId() }))));
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);

      expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(5);
      expect(rejected.some((error) => error instanceof ServiceUnavailableError)).toBe(false);
      expect(rejected.every((error) => error instanceof ConflictError)).toBe(true);
      expect((await VariantModel.findById(v._id).lean())!.stock).toBe(0);
    }
  });

  it("a burst of ten orders for different products all succeed — the store-wide order sequence no longer exhausts the retry budget", async () => {
    const carts = [];
    for (let i = 0; i < 10; i++) carts.push(await cartWith((await variant())._id, 1));

    const settled = await Promise.allSettled(carts.map((cart) => placeOrder(input(cart._id, { customerId: new mongoose.Types.ObjectId() }))));

    const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => String(r.reason));
    expect(failures).toEqual([]);
    const numbers = settled.map((r) => (r as PromiseFulfilledResult<{ orderNumber: string }>).value.orderNumber);
    expect(new Set(numbers).size).toBe(10);
  });

  it("an order that does not sell a variant out leaves the product document untouched", async () => {
    const v = await variant(10);
    const before = (await ProductModel.findById(v.productId).lean())!;
    await placeOrder(input((await cartWith(v._id, 1))._id, { customerId: new mongoose.Types.ObjectId() }));
    const after = (await ProductModel.findById(v.productId).lean())!;
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)); // not one field rewritten
  });

  it("an order that sells the last unit updates the product's listing in the same transaction", async () => {
    const v = await variant(1);
    await placeOrder(input((await cartWith(v._id, 1))._id, { customerId: new mongoose.Types.ObjectId() }));
    expect((await ProductModel.findById(v.productId).lean())!.listing?.purchasableVariantCount).toBe(0);
  });
});
