// @vitest-environment node
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { buildCartLineIdentityKey, CartLineModel } from "../../commerce/cart-line.schema";
import { CartModel } from "../../commerce/cart.schema";
import { OrderLineModel, OrderModel } from "../../commerce/order.schema";
import { OrderSequenceModel } from "../../commerce/order-sequence.schema";
import { StockMovementModel } from "../../catalog/stock-movement.schema";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { connectToDatabase } from "../../core/db/connect";
import { orderLineRepository, orderRepository } from "../../core/repositories";
import { InvoiceSequenceModel } from "../../invoices/invoice-sequence.schema";
import { getInvoiceForOrder } from "../../invoices/get-invoice";
import { transitionOrderStatus } from "../../admin/orders/transition-order-status";
import { placeOrder } from "./place-order";
import type { PlaceOrderInput } from "./place-order.types";

/*
 * Checkout notes and invoice numbering, through the real placement transaction. A new file rather than more of
 * `place-order.integration.test.ts`: it owns its own seed, and its counters are the ones it resets.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

async function reset() {
  await Promise.all([
    CategoryModel.deleteMany({}),
    ProductModel.deleteMany({}),
    VariantModel.deleteMany({}),
    CartModel.deleteMany({}),
    CartLineModel.deleteMany({}),
    OrderModel.deleteMany({}),
    OrderLineModel.deleteMany({}),
    OrderSequenceModel.deleteMany({}),
    InvoiceSequenceModel.deleteMany({}),
    StockMovementModel.deleteMany({}),
    StoreProfileModel.deleteMany({}),
  ]);
}

beforeAll(async () => {
  await connectToDatabase();
  await reset();
});
beforeEach(reset);
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await reset();
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

/** One variant with plenty of stock; each call makes a fresh cart so placements never share one. */
async function seedCatalog() {
  const category = await CategoryModel.create({ slug: "electronics" });
  const product = await ProductModel.create({ slug: `product-${new mongoose.Types.ObjectId()}`, categoryId: category._id, lifecycle: "published", name: { en: "Test Product", ar: "منتج" } });
  const variant = await VariantModel.create({
    productId: product._id,
    sku: `SKU-${new mongoose.Types.ObjectId()}`,
    variantKey: `key-${new mongoose.Types.ObjectId()}`,
    price: toMoney("100.00"),
    stock: 500,
    backorderPolicy: "DENY",
  });
  return variant;
}

async function newCart(variantId: mongoose.Types.ObjectId) {
  const cart = await CartModel.create({});
  await CartLineModel.create({ cartId: cart._id, variantId, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variantId, undefined) });
  return cart;
}

const input = (cartId: mongoose.Types.ObjectId, overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({
  cartId,
  idempotencyKey: `key-${new mongoose.Types.ObjectId()}`,
  termsVersionAccepted: 1,
  guestContact: { name: "Mona Adel", phone: "+201000000001" },
  fulfilment: { mode: "DELIVERY", addressSnapshot: { recipientName: "Mona Adel", phone: "+201000000001", addressLine1: "1 Nile St", city: "Cairo", governorate: "Cairo" }, zoneName: "cairo" },
  paymentMethod: "COD",
  requiresPaymentProof: false,
  requiresProviderIntegration: false,
  now: new Date(2026, 7, 28, 10, 0),
  tax: { mode: "INCLUDED", rate: 14 },
  shippingSettings: SHIPPING,
  locale: "en",
  ...overrides,
});

const orderDoc = async (orderId: mongoose.Types.ObjectId) => (await OrderModel.findById(orderId).lean())!;

describe("checkout notes (#41)", () => {
  it("stores the note on the order", async () => {
    const variant = await seedCatalog();
    const result = await placeOrder(input((await newCart(variant._id))._id, { notes: "Leave with the neighbour" }));
    expect((await orderDoc(result.orderId)).notes).toBe("Leave with the neighbour");
  });

  it("stores the trimmed value", async () => {
    const variant = await seedCatalog();
    const result = await placeOrder(input((await newCart(variant._id))._id, { notes: "   ring twice \n" }));
    expect((await orderDoc(result.orderId)).notes).toBe("ring twice");
  });

  it("leaves the field absent when there is no note — absent, not an empty string", async () => {
    const variant = await seedCatalog();
    const result = await placeOrder(input((await newCart(variant._id))._id));
    expect("notes" in (await orderDoc(result.orderId))).toBe(false);
  });

  it("treats a note that is blank after trimming as no note", async () => {
    const variant = await seedCatalog();
    const result = await placeOrder(input((await newCart(variant._id))._id, { notes: "   " }));
    expect("notes" in (await orderDoc(result.orderId))).toBe(false);
  });
});

describe("invoice numbering (#60)", () => {
  it("allocates INV-000001, INV-000002 … from its own counter, independent of the order number", async () => {
    const variant = await seedCatalog();
    // Burn order numbers so the two sequences visibly differ.
    await OrderSequenceModel.create({ key: "order", value: 41 });

    const first = await placeOrder(input((await newCart(variant._id))._id));
    const second = await placeOrder(input((await newCart(variant._id))._id));

    expect(first.orderNumber).toBe("ORD-000042");
    expect([first.invoiceNumber, second.invoiceNumber]).toEqual(["INV-000001", "INV-000002"]);
    expect((await orderDoc(first.orderId)).invoiceNumber).toBe("INV-000001");
  });

  it("freezes the seller and the tax mode onto the order at placement", async () => {
    await StoreProfileModel.create({
      name: { en: "Acme Store", ar: "متجر أكمي" },
      tagline: { en: "t", ar: "ت" },
      description: { en: "d", ar: "و" },
      contact: { phone: "+20100", email: "hi@acme.example" },
      currency: "EGP",
    });
    const variant = await seedCatalog();
    const result = await placeOrder(input((await newCart(variant._id))._id));

    // The store is renamed afterwards — the order's invoice must not follow.
    await StoreProfileModel.updateMany({}, { $set: { "name.en": "Renamed Store" } });

    const order = await orderDoc(result.orderId);
    expect(order.invoiceSnapshot).toMatchObject({ seller: { name: { en: "Acme Store" }, phone: "+20100", email: "hi@acme.example" }, tax: { mode: "INCLUDED", rate: 14 } });
    expect(order.invoiceSnapshot?.issuedAt).toEqual(new Date(2026, 7, 28, 10, 0));
  });

  it("hands out unique, gap-free numbers across concurrent placements", async () => {
    const variant = await seedCatalog();
    const carts = await Promise.all(Array.from({ length: 6 }, () => newCart(variant._id)));

    // allSettled: on one dev replica set, contention on the counter can exhaust a caller's retry budget — which is a
    // clean failure that rolled its number back. What must hold is about the COMMITTED orders.
    const outcomes = await Promise.allSettled(carts.map((cart) => placeOrder(input(cart._id))));
    const placed = outcomes.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
    expect(placed.length).toBeGreaterThan(0);

    const numbers = placed.map((result) => result.invoiceNumber).sort();
    expect(new Set(numbers).size).toBe(numbers.length);
    // Contiguous from 1: every failed attempt returned its number, so there is no hole among the committed ones.
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => `INV-${String(index + 1).padStart(6, "0")}`));
    const stored = (await OrderModel.find({}, { invoiceNumber: 1 }).lean()).map((order) => order.invoiceNumber).sort();
    expect(stored).toEqual(numbers);
  });

  it("a placement that rolls back consumes no invoice number and no order number", async () => {
    const variant = await seedCatalog();
    const first = await placeOrder(input((await newCart(variant._id))._id));
    expect(first.invoiceNumber).toBe("INV-000001");

    // Fail AFTER the order (and both numbers) were written, so there is real work for the rollback to undo.
    const original = orderLineRepository.save.bind(orderLineRepository);
    vi.spyOn(orderLineRepository, "save").mockImplementationOnce(async (...args: Parameters<typeof original>) => {
      await original(...args);
      throw new Error("injected failure after the order was written");
    });
    await expect(placeOrder(input((await newCart(variant._id))._id))).rejects.toThrow(/injected failure/);

    expect(await OrderModel.countDocuments()).toBe(1);
    expect((await InvoiceSequenceModel.findOne({ key: "invoice" }).lean())?.value).toBe(1);
    expect((await OrderSequenceModel.findOne({ key: "order" }).lean())?.value).toBe(1);

    const next = await placeOrder(input((await newCart(variant._id))._id));
    expect(next.invoiceNumber).toBe("INV-000002");
    expect(next.orderNumber).toBe("ORD-000002");
  });

  it("a cancelled order keeps its number, its invoice reads VOID, and the number is never reused", async () => {
    const variant = await seedCatalog();
    const first = await placeOrder(input((await newCart(variant._id))._id));

    await transitionOrderStatus({ orderId: first.orderId.toString(), to: "CANCELLED", reason: "Customer changed their mind", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() });

    const invoice = await getInvoiceForOrder(await orderRepository.findOne({ where: { _id: first.orderId } }));
    expect(invoice).toMatchObject({ invoiceNumber: "INV-000001", status: "VOID" });
    expect(invoice.voidedAt).toBeInstanceOf(Date);

    const second = await placeOrder(input((await newCart(variant._id))._id));
    expect(second.invoiceNumber).toBe("INV-000002"); // no gap, no reuse
  });

  it("builds the invoice from the order's own snapshot: renamed products and repriced variants do not change it", async () => {
    const variant = await seedCatalog();
    const result = await placeOrder(input((await newCart(variant._id))._id, { notes: "gift" }));

    await VariantModel.updateOne({ _id: variant._id }, { $set: { price: toMoney("999.00"), sku: "CHANGED" } });
    await ProductModel.updateMany({}, { $set: { "name.en": "Renamed" } });

    const invoice = await getInvoiceForOrder(await orderRepository.findOne({ where: { _id: result.orderId } }));
    expect(invoice.lines[0]).toMatchObject({ productName: "Test Product", quantity: 1 });
    expect(invoice.lines[0]!.sku).toBe(variant.sku);
    expect(invoice.lines[0]!.unitPrice.toFixed(2)).toBe("100.00");
    expect([invoice.subtotal, invoice.shipping, invoice.total].map((amount) => amount.toFixed(2))).toEqual(["100.00", "20.00", "120.00"]);
    expect(invoice.tax.mode).toBe("INCLUDED");
  });
});
