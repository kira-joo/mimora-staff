import { toMoney } from "@kira-joo/toolkit-common";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * Promotion identity (approved 2026-10-22): usage is counted by the promotion id frozen on each order
 * (`Order.appliedPromotion`), not by a code string — so a rename or removal of the code cannot reset
 * a customer's limit, and automatic promotions with a per-customer limit work. Orders placed before
 * the snapshot existed are still counted by their line code. Nothing historical is rewritten.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
  // Another suite may have left orders behind; a stale ORD-000001 would collide with this one's first order.
  await Promise.all([OrderModel.deleteMany({}), OrderLineModel.deleteMany({}), OrderSequenceModel.deleteMany({})]);
});
// Before AND after: order numbers and usage counts are database-wide, so the file owns its starting state.
const clean = async () => {
  for (const model of [CategoryModel, ProductModel, VariantModel, CartModel, CartLineModel, OrderModel, OrderLineModel, OrderSequenceModel, PromotionModel] as const) {
    await (model as mongoose.Model<unknown>).deleteMany({});
  }
};
beforeEach(clean);
afterEach(clean);
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

let variantId: mongoose.Types.ObjectId;
async function fresh() {
  const category = await CategoryModel.create({ slug: `c-${new mongoose.Types.ObjectId()}` });
  const product = await ProductModel.create({ slug: `p-${new mongoose.Types.ObjectId()}`, categoryId: category._id, lifecycle: "published", name: { en: "Kettle", ar: "غلاية" } });
  variantId = (await VariantModel.create({ productId: product._id, sku: `S-${new mongoose.Types.ObjectId()}`, variantKey: `k-${new mongoose.Types.ObjectId()}`, price: toMoney("100.00"), stock: 100 }))._id;
}
async function cart(code?: string) {
  const c = await CartModel.create(code ? { appliedPromotionCode: code } : {});
  await CartLineModel.create({ cartId: c._id, variantId, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(c._id, variantId, undefined) });
  return c._id;
}
function input(cartId: mongoose.Types.ObjectId, customerId?: mongoose.Types.ObjectId): PlaceOrderInput {
  return {
    cartId,
    idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
    termsVersionAccepted: 1,
    ...(customerId ? { customerId } : { guestContact: { name: "G", phone: "+201000000000" } }),
    fulfilment: { mode: "DELIVERY", addressSnapshot: { recipientName: "A", phone: "+201000000000", addressLine1: "1", city: "Cairo", governorate: "Cairo" }, zoneName: "cairo" },
    paymentMethod: "COD",
    requiresPaymentProof: false,
    requiresProviderIntegration: false,
    now: new Date(2026, 9, 22, 10, 0),
    tax: { mode: "ADDED", rate: 0 },
    shippingSettings: SHIPPING,
    locale: "en",
  };
}
const promo = (overrides: Record<string, unknown>) =>
  PromotionModel.create({ name: { en: "Ten", ar: "عشرة" }, description: { en: "x", ar: "x" }, type: "PERCENT", value: toMoney("10"), conditions: {}, ...overrides });
const discounted = (r: { discount: { toFixed(n: number): string } }) => r.discount.toFixed(2) !== "0.00";

describe("promotion identity — usage is counted by promotion id", () => {
  it("snapshots the promotion on the order: id, code, automatic flag, name, type and value", async () => {
    await fresh();
    const p = await promo({ code: "TEN" });
    const placed = await placeOrder(input(await cart("TEN"), new mongoose.Types.ObjectId()));
    const order = await OrderModel.findById(placed.orderId).lean();
    expect(order?.appliedPromotion).toMatchObject({ promotionId: p._id, code: "TEN", automatic: false, name: { en: "Ten", ar: "عشرة" }, type: "PERCENT" });
    expect(new Decimal(order!.appliedPromotion!.value!.toString()).toFixed(2)).toBe("10.00");
  });

  it("RENAMING the code does not reset a customer's limit", async () => {
    await fresh();
    const p = await promo({ code: "ONCE", limits: { perCustomerUses: 1 } });
    const customer = new mongoose.Types.ObjectId();
    expect(discounted(await placeOrder(input(await cart("ONCE"), customer)))).toBe(true);

    await PromotionModel.updateOne({ _id: p._id }, { $set: { code: "RENAMED" } });

    expect(discounted(await placeOrder(input(await cart("RENAMED"), customer)))).toBe(false);
  });

  it("REMOVING the code (the promotion becomes automatic) does not reset it either", async () => {
    await fresh();
    const p = await promo({ code: "ONCE", limits: { perCustomerUses: 1 } });
    const customer = new mongoose.Types.ObjectId();
    expect(discounted(await placeOrder(input(await cart("ONCE"), customer)))).toBe(true);

    await PromotionModel.updateOne({ _id: p._id }, { $unset: { code: "" } });

    expect(discounted(await placeOrder(input(await cart(), customer)))).toBe(false);
  });

  it("an AUTOMATIC promotion with a per-customer limit is granted exactly that often, per customer", async () => {
    await fresh();
    await promo({ limits: { perCustomerUses: 2 } });
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const forA = [];
    for (let i = 0; i < 3; i++) forA.push(discounted(await placeOrder(input(await cart(), a))));
    expect(forA).toEqual([true, true, false]);
    expect(discounted(await placeOrder(input(await cart(), b)))).toBe(true);
  });

  it("CONCURRENT: one customer racing three orders for a once-per-customer automatic promotion gets it once", async () => {
    for (let round = 0; round < 4; round++) {
      await fresh();
      const p = await promo({ name: { en: `R${round}`, ar: "ر" }, limits: { perCustomerUses: 1 } });
      const customer = new mongoose.Types.ObjectId();
      const carts = [await cart(), await cart(), await cart()];
      const results = await Promise.all(carts.map((c) => placeOrder(input(c, customer))));
      expect(results.filter(discounted)).toHaveLength(1);
      expect((await PromotionModel.findById(p._id).lean())!.usageCount).toBe(1);
      await PromotionModel.deleteMany({});
    }
  });

  it("LEGACY: an order placed before the snapshot (code on its lines only) still counts", async () => {
    await fresh();
    await promo({ code: "LEGACY", limits: { perCustomerUses: 1 } });
    const customer = new mongoose.Types.ObjectId();
    const old = await OrderModel.create({
      orderNumber: "ORD-LEGACY1", idempotencyKey: "legacy-1", customerId: customer, status: "DELIVERED", placedAt: new Date(2026, 9, 1),
      subtotal: new Decimal("100"), discount: new Decimal("10"), total: new Decimal("90"),
      fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "S", address: "A", phone: "1" } },
      payment: { method: "COD", status: "NOT_REQUIRED" },
    });
    await OrderLineModel.create({ orderId: old._id, lineNumber: 1, variantId, sku: "S", productName: "P", variantDescription: "P", quantity: 1, unitPrice: new Decimal("100"), lineTotal: new Decimal("100"), promotionCode: "LEGACY" });
    expect(old.appliedPromotion).toBeUndefined(); // historical order is left exactly as it was

    expect(discounted(await placeOrder(input(await cart("LEGACY"), customer)))).toBe(false);
    expect((await OrderModel.findById(old._id).lean())!.appliedPromotion).toBeUndefined(); // never rewritten
  });

  it("an order is not counted twice when it carries BOTH the snapshot and the line code", async () => {
    await fresh();
    await promo({ code: "TWICE", limits: { perCustomerUses: 2 } });
    const customer = new mongoose.Types.ObjectId();
    expect(discounted(await placeOrder(input(await cart("TWICE"), customer)))).toBe(true); // snapshot + line code
    expect(discounted(await placeOrder(input(await cart("TWICE"), customer)))).toBe(true); // 1 use counted, not 2
  });

  it("the snapshot is frozen: editing the promotion afterwards leaves the order untouched", async () => {
    await fresh();
    const p = await promo({ code: "TEN" });
    const placed = await placeOrder(input(await cart("TEN"), new mongoose.Types.ObjectId()));
    await PromotionModel.updateOne({ _id: p._id }, { $set: { name: { en: "Changed", ar: "تغير" }, value: toMoney("50"), code: "FIFTY" } });
    const order = await OrderModel.findById(placed.orderId).lean();
    expect(order?.appliedPromotion).toMatchObject({ code: "TEN", name: { en: "Ten" } });
    expect(new Decimal(order!.appliedPromotion!.value!.toString()).toFixed(2)).toBe("10.00");
  });

  it("a cancelled order gives its use back", async () => {
    await fresh();
    await promo({ limits: { perCustomerUses: 1 } });
    const customer = new mongoose.Types.ObjectId();
    const first = await placeOrder(input(await cart(), customer));
    await OrderModel.updateOne({ _id: first.orderId }, { $set: { status: "CANCELLED" } });
    expect(discounted(await placeOrder(input(await cart(), customer)))).toBe(true);
  });

  it("a guest is never granted a per-customer-limited promotion (their uses cannot be counted)", async () => {
    await fresh();
    await promo({ limits: { perCustomerUses: 1 } });
    expect(discounted(await placeOrder(input(await cart())))).toBe(false);
  });
});
