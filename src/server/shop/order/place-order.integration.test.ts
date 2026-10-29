import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { placeOrderService } from "./place-order";
import { updatePage } from "../../admin/pages/update-page";
import { CartModel } from "../../commerce/cart.schema";
import { CartLineModel, buildCartLineIdentityKey } from "../../commerce/cart-line.schema";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { ProductModel } from "../../catalog/product.schema";
import { FulfilmentSettingsModel } from "../../fulfilment/fulfilment-settings.schema";
import { PickupLocationModel } from "../../fulfilment/pickup-location.schema";
import { PaymentSettingsModel } from "../../fulfilment/payment-settings.schema";
import { OrderSequenceModel } from "../../commerce/order-sequence.schema";
import { PageModel } from "../../content/page.schema";
import { connectToDatabase } from "../../core/db/connect";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

function customerIdentity(): CustomerIdentity {
  return { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
}

async function createFulfilmentSettings() {
  return FulfilmentSettingsModel.create({
    deliveryEnabled: true,
    pickupEnabled: true,
    shippingFeeMode: "FLAT",
    flatShippingFee: new Decimal("5.00"),
    defaultDispatchLeadDays: 2,
    cutoffTime: "14:00",
    orderMinimum: new Decimal("0"),
    customerCancelWindowMinutes: 30,
    tax: { mode: "INCLUDED", rate: 0 },
  });
}

async function createPaymentSettings() {
  return PaymentSettingsModel.create({
    methods: [
      { method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false },
      { method: "TRANSFER", enabled: true, order: 1, requiresProof: true, requiresProviderIntegration: false, destination: { accountName: "Acme Store", number: "1234567890" } },
    ],
  });
}

async function createProductAndVariant(sku: string, price: string, stock = 10) {
  const product = await ProductModel.create({
    slug: `product-${sku.toLowerCase()}`,
    categoryId: new mongoose.Types.ObjectId(),
    name: { en: "Test Product", ar: "منتج تجريبي" },
    lifecycle: "published",
  });

  const variant = await VariantModel.create({
    productId: product._id,
    sku,
    variantKey: `key-${sku}`,
    stock,
    price: new Decimal(price),
    backorderPolicy: "DENY",
  });

  return { product, variant };
}

async function createPickupLocation() {
  return PickupLocationModel.create({
    name: { en: "Main Store", ar: "المتجر الرئيسي" },
    address: { en: "123 Main St", ar: "١٢٣ الشارع الرئيسي" },
    phone: "555-0100",
    active: true,
  });
}

async function publishTerms(version = 1) {
  return PageModel.create({ slug: "terms", title: { en: "Terms of sale", ar: "شروط البيع" }, content: { en: "Terms.", ar: "الشروط." }, published: true, version });
}

describe("placeOrderService", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    // FulfilmentSettings, PaymentSettings and OrderSequence are singletons
    // this file writes; clear them so a later test file sharing this
    // database doesn't inherit them.
    await FulfilmentSettingsModel.deleteMany({});
    await PaymentSettingsModel.deleteMany({});
    await OrderSequenceModel.deleteMany({});
    await PageModel.deleteMany({});
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await CartModel.deleteMany({});
    await CartLineModel.deleteMany({});
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await VariantModel.deleteMany({});
    await ProductModel.deleteMany({});
    await PickupLocationModel.deleteMany({});
    await FulfilmentSettingsModel.deleteMany({});
    await PaymentSettingsModel.deleteMany({});
    // This service calls the real placement engine, which allocates from
    // the shared, merchant-wide OrderSequenceModel counter — reset it too,
    // or a later test file sharing this database sees a stale sequence.
    await OrderSequenceModel.deleteMany({});
    // D-13: an order needs published terms to accept.
    await PageModel.deleteMany({});
    await publishTerms();
  });

  it("places order successfully with pickup fulfilment", async () => {
    const customer = customerIdentity();
    const { variant } = await createProductAndVariant("TEST-001", "50.00");
    const location = await createPickupLocation();
    await createFulfilmentSettings();
    await createPaymentSettings();

    const cart = await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id },
    });

    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 2, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });

    const result = await placeOrderService({
      customer,
      paymentMethod: "COD",
      termsVersionAccepted: 1,
      idempotencyKey: "test-key-1",
      locale: "en",
      now: new Date(),
    });

    expect(result.orderNumber).toMatch(/^ORD-\d{6}$/);
    expect(result.status).toBe("PLACED");
    expect(result.paymentStatus).toBe("NOT_REQUIRED");
    expect(result.subtotal.toFixed(2)).toBe("100.00");
    expect(result.total.toFixed(2)).toBe("100.00");

    const order = await OrderModel.findOne({ orderNumber: result.orderNumber });
    expect(order).toBeTruthy();
    expect(order!.customerId?.toString()).toBe(customer._id);
    expect(order!.payment.method).toBe("COD");

    const lines = await OrderLineModel.find({ orderId: order!._id });
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);

    // Verify stock decremented
    const updatedVariant = await VariantModel.findById(variant._id);
    expect(updatedVariant!.stock).toBe(8);

    // Verify cart cleared
    const cartLines = await CartLineModel.find({ cartId: cart._id });
    expect(cartLines).toHaveLength(0);
  });

  it("snapshots the pickup location's name/address resolved to the placement locale", async () => {
    const customer = customerIdentity();
    const { variant } = await createProductAndVariant("TEST-LOC", "20.00");
    const location = await createPickupLocation();
    await createFulfilmentSettings();
    await createPaymentSettings();

    const cart = await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id },
    });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });

    const result = await placeOrderService({
      customer,
      paymentMethod: "COD",
      termsVersionAccepted: 1,
      idempotencyKey: "test-key-loc",
      locale: "ar",
      now: new Date(),
    });

    const order = await OrderModel.findOne({ orderNumber: result.orderNumber }).lean();
    expect(order!.fulfilment.pickupLocationSnapshot?.name).toBe("المتجر الرئيسي");
    expect(order!.fulfilment.pickupLocationSnapshot?.address).toBe("١٢٣ الشارع الرئيسي");
  });

  it("throws NotFoundError when cart does not exist", async () => {
    const customer = customerIdentity();

    await expect(
      placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted: 1, idempotencyKey: "test-key-2", locale: "en", now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when cart has no lines", async () => {
    const customer = customerIdentity();

    await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "PICKUP", pickupLocationId: new mongoose.Types.ObjectId() },
    });

    await expect(
      placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted: 1, idempotencyKey: "test-key-3", locale: "en", now: new Date() })
    ).rejects.toThrow(ConflictError);
  });

  it("throws ConflictError when fulfilmentDraft is missing", async () => {
    const customer = customerIdentity();
    const { variant } = await createProductAndVariant("TEST-002", "25.00", 5);

    const cart = await CartModel.create({ customerId: customer._id });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });

    await expect(
      placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted: 1, idempotencyKey: "test-key-4", locale: "en", now: new Date() })
    ).rejects.toThrow(ConflictError);
  });

  it("throws NotFoundError when pickup location is invalid", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const { variant } = await createProductAndVariant("TEST-003", "30.00", 5);

    const cart = await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "PICKUP", pickupLocationId: new mongoose.Types.ObjectId() }, // non-existent
    });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });

    await expect(
      placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted: 1, idempotencyKey: "test-key-5", locale: "en", now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when delivery address is missing", async () => {
    const customer = customerIdentity();
    await createFulfilmentSettings();
    const { variant } = await createProductAndVariant("TEST-004", "40.00", 5);

    const cart = await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "DELIVERY" }, // no address
    });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });

    await expect(
      placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted: 1, idempotencyKey: "test-key-6", locale: "en", now: new Date() })
    ).rejects.toThrow(ConflictError);
  });

  it("marks a TRANSFER payment as AWAITING_PAYMENT", async () => {
    const customer = customerIdentity();
    const { variant } = await createProductAndVariant("TEST-TRANSFER", "60.00");
    const location = await createPickupLocation();
    await createFulfilmentSettings();
    await createPaymentSettings();

    const cart = await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id },
    });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });

    const result = await placeOrderService({
      customer,
      paymentMethod: "TRANSFER",
      termsVersionAccepted: 1,
      idempotencyKey: "test-key-transfer",
      locale: "en",
      now: new Date(),
    });

    expect(result.paymentStatus).toBe("AWAITING_PAYMENT");

    const order = await OrderModel.findOne({ orderNumber: result.orderNumber }).lean();
    expect(order?.payment.destinationSnapshot?.accountName).toBe("Acme Store");
  });

  it("throws NotFoundError when the requested payment method is not configured", async () => {
    const customer = customerIdentity();
    const { variant } = await createProductAndVariant("TEST-BADMETHOD", "10.00");
    const location = await createPickupLocation();
    await createFulfilmentSettings();
    await createPaymentSettings(); // configures only COD and TRANSFER

    const cart = await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id },
    });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });

    await expect(
      placeOrderService({ customer, paymentMethod: "WALLET", termsVersionAccepted: 1, idempotencyKey: "test-key-badmethod", locale: "en", now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the requested payment method is disabled", async () => {
    const customer = customerIdentity();
    const { variant } = await createProductAndVariant("TEST-DISABLED", "10.00");
    const location = await createPickupLocation();
    await createFulfilmentSettings();
    await PaymentSettingsModel.create({
      methods: [{ method: "COD", enabled: false, order: 0, requiresProof: false, requiresProviderIntegration: false }],
    });

    const cart = await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id },
    });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });

    await expect(
      placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted: 1, idempotencyKey: "test-key-disabled", locale: "en", now: new Date() })
    ).rejects.toThrow(NotFoundError);
  });

  describe("D-13 — the accepted terms version", () => {
    async function readyPickupCart(sku: string) {
      const customer = customerIdentity();
      const { variant } = await createProductAndVariant(sku, "20.00");
      const location = await createPickupLocation();
      await createFulfilmentSettings();
      await createPaymentSettings();
      const cart = await CartModel.create({ customerId: customer._id, fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id } });
      await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });
      return { customer, cart, variant };
    }

    const place = (customer: CustomerIdentity, termsVersionAccepted: number, now = new Date()) =>
      placeOrderService({ customer, paymentMethod: "COD", termsVersionAccepted, idempotencyKey: `k-${new mongoose.Types.ObjectId()}`, locale: "en", now });

    it("records the accepted version and when it was accepted", async () => {
      const { customer } = await readyPickupCart("TERMS-OK");
      const now = new Date("2026-10-12T10:00:00Z");
      const result = await place(customer, 1, now);

      const order = await OrderModel.findById(result.orderId).lean();
      expect(order?.termsVersionAccepted).toBe(1);
      expect(order?.acceptedAt?.toISOString()).toBe(now.toISOString());
    });

    it("refuses a stale version after the terms are edited, and places nothing", async () => {
      const { customer, cart, variant } = await readyPickupCart("TERMS-STALE");
      const terms = await PageModel.findOne({ slug: "terms" });
      await updatePage(terms!._id.toString(), { content: { en: "New terms.", ar: "شروط جديدة." } });

      const error = await place(customer, 1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toMatchObject({ field: "termsVersionAccepted", reason: "TERMS_VERSION_CHANGED", currentVersion: 2 });

      expect(await OrderModel.countDocuments({})).toBe(0);
      expect(await CartLineModel.countDocuments({ cartId: cart._id })).toBe(1);
      expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(10);

      // Accepting the version that is live now succeeds.
      const result = await place(customer, 2);
      expect((await OrderModel.findById(result.orderId).lean())?.termsVersionAccepted).toBe(2);
    });

    it("refuses a version ahead of the live one", async () => {
      const { customer } = await readyPickupCart("TERMS-AHEAD");
      await expect(place(customer, 2)).rejects.toThrow(ConflictError);
    });

    it("refuses every order while no terms page is published", async () => {
      const { customer } = await readyPickupCart("TERMS-NONE");
      await PageModel.updateOne({ slug: "terms" }, { $set: { published: false } });

      const error = await place(customer, 1).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).details).toMatchObject({ reason: "TERMS_NOT_PUBLISHED" });
      expect(await OrderModel.countDocuments({})).toBe(0);
    });
  });
});
