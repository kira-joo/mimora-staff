// @vitest-environment node
import { ConflictError, ServiceUnavailableError } from "@kira-joo/backend-toolkit-core";
import { sanitizeLeanResult } from "@kira-joo/backend-toolkit-mongoose";
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

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
/*
 * `connectToDatabase()` passes `dbName: process.env.MONGODB_DB ||
 * "store-platform-staff"` to `mongoose.connect()`, and that option overrides
 * whatever database name appears in the URI's path — the `-test` suffix
 * above is silently ignored without this. Without it, every integration
 * test in this repo runs against the same database a local `npm run dev`
 * session defaults to.
 */
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
  // Another suite may have left orders behind; a stale ORD-000001 would collide with this one's first order. The same
  // holds for catalog rows now that category slugs are unique: a leftover "electronics" refuses this file's seed.
  await Promise.all([
    OrderModel.deleteMany({}),
    OrderLineModel.deleteMany({}),
    OrderSequenceModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    VariantModel.deleteMany({}),
  ]);
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
    PromotionModel.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

const NO_SHIPPING = {
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
const NO_TAX = { mode: "ADDED" as const, rate: 0 };

/** `CartLine` is a standalone collection (Phase 4B Batch 3) — this is the one place this suite creates one. */
async function createCartLine(cartId: mongoose.Types.ObjectId, variantId: mongoose.Types.ObjectId, quantity: number) {
  return CartLineModel.create({ cartId, variantId, quantity, lineIdentityKey: buildCartLineIdentityKey(cartId, variantId, undefined) });
}

async function seed(options: { stock?: number; price?: string; backorderPolicy?: "DENY" | "CONTINUE_SELLING" } = {}) {
  // Unique per call, like the product and variant below: category slugs are unique, and one test may seed twice.
  const category = await CategoryModel.create({ slug: `electronics-${new mongoose.Types.ObjectId().toString()}` });
  const product = await ProductModel.create({
    slug: `product-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "Test Product", ar: "منتج تجريبي" },
  });
  const variant = await VariantModel.create({
    productId: product._id,
    sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
    variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    price: toMoney(options.price ?? "100.00"),
    stock: options.stock ?? 10,
    backorderPolicy: options.backorderPolicy ?? "DENY",
  });
  const cart = await CartModel.create({});
  await createCartLine(cart._id, variant._id, 2);

  return { category, product, variant, cart };
}

function baseInput(cartId: mongoose.Types.ObjectId, overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    cartId,
    idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
    termsVersionAccepted: 1,
    guestContact: { name: "Test Customer", phone: "+201000000000" },
    fulfilment: {
      mode: "DELIVERY",
      addressSnapshot: {
        recipientName: "Test Customer",
        phone: "+201000000000",
        addressLine1: "1 Test St",
        city: "Cairo",
        governorate: "Cairo",
      },
      zoneName: "cairo",
    },
    paymentMethod: "COD",
    requiresPaymentProof: false,
    requiresProviderIntegration: false,
    now: new Date(2026, 7, 28, 10, 0),
    tax: NO_TAX,
    shippingSettings: NO_SHIPPING,
    locale: "en",
    ...overrides,
  };
}

describe("placing an order", () => {
  it("prices from the catalog and creates an order with a matching order line", async () => {
    const { cart, variant } = await seed({ price: "100.00" });

    const result = await placeOrder(baseInput(cart._id));

    expect(result.orderNumber).toBe("ORD-000001");
    expect(result.subtotal.toFixed(2)).toBe("200.00"); // 100.00 × 2
    expect(result.total.toFixed(2)).toBe("220.00"); // + 20.00 shipping, no tax
    expect(result.status).toBe("PLACED");
    expect(result.paymentStatus).toBe("NOT_REQUIRED");

    const lines = sanitizeLeanResult(await OrderLineModel.find({ orderId: result.orderId }).lean());
    expect(lines).toHaveLength(1);
    expect(lines[0]?.sku).toBe(variant.sku);
    expect(lines[0]?.quantity).toBe(2);
    expect(lines[0]?.unitPrice.toFixed(2)).toBe("100.00");
  });

  it("snapshots the product id and the options as the customer saw them — localized labels, keys where none exist", async () => {
    const category = await CategoryModel.create({ slug: "apparel" });
    const product = await ProductModel.create({
      slug: `product-${new mongoose.Types.ObjectId().toString()}`,
      categoryId: category._id,
      lifecycle: "published",
      name: { en: "Shirt", ar: "قميص" },
      optionAxes: [
        { key: "colour", name: { en: "Colour", ar: "اللون" }, values: [{ key: "olive", label: { en: "Olive", ar: "زيتوني" } }] },
        { key: "size", name: { en: "Size", ar: "المقاس" } },
      ],
    });
    const variant = await VariantModel.create({
      productId: product._id,
      sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
      variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
      optionValues: [
        { key: "colour", value: "olive" },
        { key: "size", value: "M" },
      ],
      price: toMoney("100.00"),
      stock: 5,
      backorderPolicy: "DENY",
    });
    const cart = await CartModel.create({});
    await createCartLine(cart._id, variant._id, 1);

    const result = await placeOrder(baseInput(cart._id, { locale: "ar" }));

    const [line] = sanitizeLeanResult(await OrderLineModel.find({ orderId: result.orderId }).lean());
    expect(line?.productId?.toString()).toBe(product._id.toString());
    expect(line?.variantDescription).toBe("زيتوني / M");
  });

  it("decrements stock by the quantity ordered", async () => {
    const { cart, variant } = await seed({ stock: 10 });
    await placeOrder(baseInput(cart._id));

    const updated = await VariantModel.findById(variant._id).lean();
    expect(updated?.stock).toBe(8);
  });

  it("snapshots the price — a later change to the variant does not move the placed order", async () => {
    const { cart, variant } = await seed({ price: "100.00" });
    const result = await placeOrder(baseInput(cart._id));

    await VariantModel.updateOne({ _id: variant._id }, { $set: { price: toMoney("999.00") } });

    const order = sanitizeLeanResult(await OrderModel.findById(result.orderId).lean());
    expect(order?.subtotal.toFixed(2)).toBe("200.00"); // unchanged
  });

  it("snapshots the variant's cost price on the line — a later cost change does not move it", async () => {
    const { cart, variant } = await seed();
    await VariantModel.updateOne({ _id: variant._id }, { $set: { costPrice: toMoney("61.25") } });
    const result = await placeOrder(baseInput(cart._id));

    await VariantModel.updateOne({ _id: variant._id }, { $set: { costPrice: toMoney("70.00") } });

    const [line] = sanitizeLeanResult(await OrderLineModel.find({ orderId: result.orderId }).lean());
    expect(line.unitCost?.toFixed(2)).toBe("61.25");
    const raw = await mongoose.connection.collection("orderlines").findOne({ orderId: result.orderId });
    expect(raw?.unitCost?._bsontype).toBe("Decimal128");
  });

  it("leaves unitCost absent when the variant has no cost price, rather than inventing a zero", async () => {
    const { cart } = await seed();
    const result = await placeOrder(baseInput(cart._id));
    const raw = await mongoose.connection.collection("orderlines").findOne({ orderId: result.orderId });
    expect(raw).not.toHaveProperty("unitCost");
  });

  it("stores money as real BSON Decimal128, not a string or float", async () => {
    const { cart } = await seed();
    const result = await placeOrder(baseInput(cart._id));

    const raw = await mongoose.connection.collection("orders").findOne({ _id: result.orderId });
    expect(raw?.total?._bsontype).toBe("Decimal128");
  });

  it("empties the cart on success", async () => {
    const { cart } = await seed();
    await placeOrder(baseInput(cart._id));

    expect(await CartLineModel.countDocuments({ cartId: cart._id })).toBe(0);
  });

  it("clears an applied promotion code and increments its usage count", async () => {
    const { cart, category } = await seed({ price: "100.00" });
    await PromotionModel.create({
      code: "SAVE10",
      name: { en: "10 off", ar: "خصم ١٠" },
      description: { en: "x", ar: "x" },
      type: "PERCENT",
      value: toMoney("10"),
      conditions: { categories: [category._id] },
    });
    await CartModel.updateOne({ _id: cart._id }, { $set: { appliedPromotionCode: "SAVE10" } });

    const result = await placeOrder(baseInput(cart._id));

    expect(result.discount.toFixed(2)).toBe("20.00"); // 10% of 200.00
    expect(result.total.toFixed(2)).toBe("200.00"); // 200 - 20 + 20 shipping

    const clearedCart = await CartModel.findById(cart._id).lean();
    expect(clearedCart?.appliedPromotionCode).toBeUndefined();

    const promotion = await PromotionModel.findOne({ code: "SAVE10" }).lean();
    expect(promotion?.usageCount).toBe(1);
  });

  it("drops a promotion that no longer applies rather than blocking the order", async () => {
    const { cart } = await seed();
    await PromotionModel.create({
      code: "EXPIRED10",
      name: { en: "x", ar: "x" },
      description: { en: "x", ar: "x" },
      type: "PERCENT",
      value: toMoney("10"),
      active: false, // no longer applicable
      conditions: {},
    });
    await CartModel.updateOne({ _id: cart._id }, { $set: { appliedPromotionCode: "EXPIRED10" } });

    const result = await placeOrder(baseInput(cart._id));
    expect(result.discount.toFixed(2)).toBe("0.00");
  });
});

describe("pickup orders", () => {
  it("charges no shipping fee and snapshots the pickup location, not an address", async () => {
    const { cart } = await seed({ price: "50.00" });

    const result = await placeOrder(
      baseInput(cart._id, {
        fulfilment: {
          mode: "PICKUP",
          pickupLocationSnapshot: { name: "Downtown", address: "5 Main St", phone: "+201000000001" },
        },
      })
    );

    expect(result.total.toFixed(2)).toBe("100.00"); // 50 × 2, no shipping

    const order = await OrderModel.findById(result.orderId).lean();
    expect(order?.fulfilment.mode).toBe("PICKUP");
    expect(order?.fulfilment.pickupLocationSnapshot?.name).toBe("Downtown");
    expect(order?.fulfilment.addressSnapshot).toBeUndefined();
  });
});

describe("purchasability is re-checked, not trusted from the cart", () => {
  it("refuses a draft product even if it made it into the cart earlier", async () => {
    const { cart, product } = await seed();
    await ProductModel.updateOne({ _id: product._id }, { $set: { lifecycle: "draft" } });

    await expect(placeOrder(baseInput(cart._id))).rejects.toThrow(/no longer available/);
  });

  it("refuses insufficient stock", async () => {
    const { cart } = await seed({ stock: 1 }); // cart wants 2
    await expect(placeOrder(baseInput(cart._id))).rejects.toThrow(/no longer available/);
  });
});

describe("the rollback path", () => {
  it("leaves every collection untouched when purchasability fails after stock would have been reserved", async () => {
    // Two lines: the first has plenty of stock, the second fails purchasability.
    const category = await CategoryModel.create({ slug: "electronics" });
    const okProduct = await ProductModel.create({ slug: "product-2", categoryId: category._id, lifecycle: "published", name: { en: "Test Product", ar: "منتج تجريبي" } });
    const okVariant = await VariantModel.create({
      productId: okProduct._id,
      sku: "OK-SKU",
      variantKey: "ok-key",
      price: toMoney("10.00"),
      stock: 10,
    });
    const badProduct = await ProductModel.create({ slug: "product-3", categoryId: category._id, lifecycle: "draft", name: { en: "Test Product", ar: "منتج تجريبي" } });
    const badVariant = await VariantModel.create({
      productId: badProduct._id,
      sku: "BAD-SKU",
      variantKey: "bad-key",
      price: toMoney("5.00"),
      stock: 10,
    });
    const cart = await CartModel.create({});
    await createCartLine(cart._id, okVariant._id, 2);
    await createCartLine(cart._id, badVariant._id, 1);

    await expect(placeOrder(baseInput(cart._id, { fulfilment: { mode: "DELIVERY", zoneName: "cairo" } }))).rejects.toThrow();

    expect(await OrderModel.countDocuments({})).toBe(0);
    expect(await OrderLineModel.countDocuments({})).toBe(0);
    expect((await VariantModel.findById(okVariant._id).lean())?.stock).toBe(10);
    expect(await CartLineModel.countDocuments({ cartId: cart._id })).toBe(2); // untouched — the transaction rolled back
    expect(await OrderSequenceModel.countDocuments({})).toBe(0); // no order number allocated at all
  });

  it("returns the reserved stock when the transaction fails after decrementing it", async () => {
    // Both lines pass purchasability, but the second oversells, so the
    // first line's already-applied decrement must roll back too.
    const category = await CategoryModel.create({ slug: "electronics" });
    const product = await ProductModel.create({ slug: "product-4", categoryId: category._id, lifecycle: "published", name: { en: "Test Product", ar: "منتج تجريبي" } });
    const plentiful = await VariantModel.create({
      productId: product._id,
      sku: "PLENTY-SKU",
      variantKey: "plenty-key",
      price: toMoney("10.00"),
      stock: 10,
    });
    const scarce = await VariantModel.create({
      productId: product._id,
      sku: "SCARCE-SKU",
      variantKey: "scarce-key",
      price: toMoney("5.00"),
      stock: 1,
    });
    const cart = await CartModel.create({});
    await createCartLine(cart._id, plentiful._id, 2);
    await createCartLine(cart._id, scarce._id, 5);

    await expect(placeOrder(baseInput(cart._id))).rejects.toThrow();

    expect((await VariantModel.findById(plentiful._id).lean())?.stock).toBe(10);
    expect((await VariantModel.findById(scarce._id).lean())?.stock).toBe(1);
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("returns the order number with no gap when placement fails after allocating it", async () => {
    const { cart: firstCart } = await seed({ stock: 10 });
    await placeOrder(baseInput(firstCart._id)); // consumes ORD-000001

    // Second cart: stock runs out mid-transaction, forcing a rollback after
    // the number would have been allocated as ORD-000002.
    const { cart: failingCart } = await seed({ stock: 1 });
    await CartLineModel.updateOne({ cartId: failingCart._id }, { $set: { quantity: 5 } });

    await expect(placeOrder(baseInput(failingCart._id))).rejects.toThrow();

    const { cart: thirdCart } = await seed({ stock: 10 });
    const result = await placeOrder(baseInput(thirdCart._id));
    expect(result.orderNumber).toBe("ORD-000002"); // reused, not skipped
  });
});

describe("fulfilment capability switches", () => {
  it("refuses delivery when the merchant has it disabled", async () => {
    const { cart } = await seed();
    await expect(
      placeOrder(baseInput(cart._id, { shippingSettings: { ...NO_SHIPPING, deliveryEnabled: false } }))
    ).rejects.toThrow(/not available/);
  });
});

describe("concurrency: oversell under contention", () => {
  it("exactly two of three simultaneous placements succeed against five units of stock", async () => {
    const category = await CategoryModel.create({ slug: "electronics" });
    const product = await ProductModel.create({ slug: "product-5", categoryId: category._id, lifecycle: "published", name: { en: "Test Product", ar: "منتج تجريبي" } });
    const variant = await VariantModel.create({
      productId: product._id,
      sku: "HOT-SKU",
      variantKey: "hot-key",
      price: toMoney("10.00"),
      stock: 5,
    });

    const carts = await Promise.all(
      [0, 1, 2].map(async () => {
        const cart = await CartModel.create({});
        await createCartLine(cart._id, variant._id, 2);
        return cart;
      })
    );

    const outcomes = await Promise.allSettled(carts.map((cart) => placeOrder(baseInput(cart._id))));

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    expect(succeeded).toHaveLength(2); // 2 × 2 = 4 of 5; the third (needing 2 more) cannot fit

    const failed = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(failed).toHaveLength(1);
    /*
     * OBSERVED (Phase 7 finding): with THREE concurrent writers on one variant the
     * loser is not always a 409. In ~2 of 15 runs `withTransaction` exhausts its
     * retry budget on repeated WriteConflicts and surfaces a 503
     * ServiceUnavailableError ("could not complete after 4 attempts because of
     * repeated write conflicts") before the stock predicate gets to say "no
     * longer available". Both are retryable by the client; neither is a raw Mongo
     * error or a corrupted order. The two-buyer LAST UNIT test below stays strict.
     */
    const reason = failed[0]!.reason as Error;
    if (reason instanceof ConflictError) {
      expect(reason.message).toMatch(/no longer available/);
    } else {
      expect(reason).toBeInstanceOf(ServiceUnavailableError);
      expect(reason.message).toMatch(/repeated write conflicts/);
    }

    const finalStock = await VariantModel.findById(variant._id).lean();
    expect(finalStock?.stock).toBe(1);

    const orderNumbers = (succeeded as PromiseFulfilledResult<Awaited<ReturnType<typeof placeOrder>>>[]).map(
      (o) => o.value.orderNumber
    );
    expect(new Set(orderNumbers).size).toBe(2);
  });

  it("LAST UNIT: of two buyers wanting the final unit exactly one order is placed; the loser gets a retryable ConflictError and an intact cart", async () => {
    const category = await CategoryModel.create({ slug: "electronics" });
    const product = await ProductModel.create({ slug: "product-last", categoryId: category._id, lifecycle: "published", name: { en: "Test Product", ar: "منتج تجريبي" } });
    const variant = await VariantModel.create({
      productId: product._id,
      sku: "LAST-SKU",
      variantKey: "last-key",
      price: toMoney("10.00"),
      stock: 1,
    });

    const carts = await Promise.all(
      [0, 1].map(async () => {
        const cart = await CartModel.create({});
        await createCartLine(cart._id, variant._id, 1);
        return cart;
      })
    );

    const outcomes = await Promise.allSettled(carts.map((cart) => placeOrder(baseInput(cart._id))));

    const winners = outcomes.flatMap((o, index) => (o.status === "fulfilled" ? [index] : []));
    const losers = outcomes.flatMap((o, index) => (o.status === "rejected" ? [index] : []));
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const loser = outcomes[losers[0]!] as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ConflictError);
    expect((loser.reason as Error).message).toMatch(/no longer available/);

    expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(0);

    expect(await OrderModel.countDocuments({})).toBe(1);
    expect(await OrderLineModel.countDocuments({})).toBe(1);

    const winnerOrder = (outcomes[winners[0]!] as PromiseFulfilledResult<Awaited<ReturnType<typeof placeOrder>>>).value;
    expect(winnerOrder.orderNumber).toBeTruthy();

    // The loser's cart is untouched, so the customer can retry (or adjust) without re-adding anything.
    const loserCartId = carts[losers[0]!]!._id;
    expect(await CartLineModel.countDocuments({ cartId: loserCartId })).toBe(1);
    expect(await CartModel.findById(loserCartId).lean()).not.toBeNull();
  });
});
