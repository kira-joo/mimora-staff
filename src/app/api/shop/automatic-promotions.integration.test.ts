import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { connectToDatabase } from "src/server/core/db/connect";
import { CartModel } from "src/server/commerce/cart.schema";
import { CartLineModel, buildCartLineIdentityKey } from "src/server/commerce/cart-line.schema";
import { OrderLineModel, OrderModel } from "src/server/commerce/order.schema";
import { OrderSequenceModel } from "src/server/commerce/order-sequence.schema";
import { PromotionModel } from "src/server/commerce/promotion.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { PaymentSettingsModel } from "src/server/fulfilment/payment-settings.schema";
import { PageModel } from "src/server/content/page.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { IdempotencyRecordModel } from "src/server/commerce/idempotency-record.schema";
import { callShopRoute, type ShopRouteHandler } from "./test-support/shop-route-harness";

/*
 * Automatic (code-less) promotions, 2026-10-22. Before this, neither the quote nor placement ever
 * looked at a promotion without a code: a merchant's "free delivery over 3,000" was configured,
 * listed, and never given to anyone. Every test here prices the SAME cart through the real quote
 * route and the real order route and requires the two totals to agree — the whole point of one
 * shared choice (resolve-order-promotion.ts).
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const quoteRoute = (await import("./quote/route")) as unknown as { POST: ShopRouteHandler };
const ordersRoute = (await import("./orders/route")) as unknown as { POST: ShopRouteHandler };

// Idempotency records included: a replayed key returns the FIRST run's cached response and places nothing.
const MODELS = [IdempotencyRecordModel, CartModel, CartLineModel, OrderModel, OrderLineModel, OrderSequenceModel, PromotionModel, ProductModel, VariantModel, FulfilmentSettingsModel, PaymentSettingsModel, PageModel, RateLimitModel];

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  for (const model of MODELS) await (model as mongoose.Model<unknown>).deleteMany({});
  await FulfilmentSettingsModel.create({
    deliveryEnabled: true, pickupEnabled: false, shippingFeeMode: "FLAT", flatShippingFee: toMoney("50"),
    defaultDispatchLeadDays: 1, cutoffTime: "14:00", orderMinimum: toMoney("0"), customerCancelWindowMinutes: 30, allowGuestCheckout: true,
    tax: { mode: "INCLUDED", rate: 0 },
  });
  await PaymentSettingsModel.create({ methods: [{ method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false }] });
  await PageModel.create({ slug: "terms", title: { en: "Terms", ar: "الشروط" }, content: { en: "T", ar: "ش" }, published: true, version: 1 });
});
afterAll(async () => {
  await mongoose.disconnect();
});

let variantId: mongoose.Types.ObjectId;
async function product(price = "100.00", stock = 100) {
  const p = await ProductModel.create({ slug: `p-${new mongoose.Types.ObjectId()}`, categoryId: new mongoose.Types.ObjectId(), name: { en: "Kettle", ar: "غلاية" }, lifecycle: "published" });
  const v = await VariantModel.create({ productId: p._id, sku: `S-${new mongoose.Types.ObjectId()}`, variantKey: `k-${new mongoose.Types.ObjectId()}`, price: toMoney(price), stock });
  variantId = v._id;
  return v;
}

/** A guest cart ready for checkout: `quantity` units of the current variant, delivery chosen. */
async function cart(token: string, quantity: number, code?: string) {
  const c = await CartModel.create({
    cartToken: token,
    ...(code ? { appliedPromotionCode: code } : {}),
    fulfilmentDraft: { mode: "DELIVERY", address: { recipientName: "Sara", phone: "+201001112223", addressLine1: "1 St", city: "Cairo", governorate: "Cairo" } },
  });
  await CartLineModel.create({ cartId: c._id, variantId, quantity, lineIdentityKey: buildCartLineIdentityKey(c._id, variantId, undefined) });
}

async function automatic(overrides: Record<string, unknown>) {
  return PromotionModel.create({ name: { en: "Auto", ar: "تلقائي" }, description: { en: "x", ar: "x" }, type: "PERCENT", value: toMoney("10"), conditions: {}, ...overrides });
}

/** Quote, then place, the same cart. Returns both, so every test can require they agree. */
async function quoteThenPlace(token: string) {
  const quote = await callShopRoute(quoteRoute.POST, "/api/shop/quote", { method: "POST", headers: { "x-cart-token": token } });
  const placed = await callShopRoute(ordersRoute.POST, "/api/shop/orders", {
    method: "POST",
    headers: { "x-cart-token": token, "Idempotency-Key": `k-${Math.random()}` },
    body: { paymentMethod: "COD", termsVersionAccepted: 1, guestContact: { name: "Sara", phone: "+201001112223" } },
  });
  expect(quote.status).toBe(201);
  expect(placed.status).toBe(201);
  // The price the customer was shown is the price they were charged.
  expect(placed.body.total).toBe(quote.body.total);
  expect(placed.body.discount).toBe(quote.body.discount);
  return { quote: quote.body, placed: placed.body };
}

describe("automatic promotions — quote and placement agree", () => {
  it("applies an eligible automatic promotion with no code entered, names it, and records the use", async () => {
    await product("100.00");
    const promo = await automatic({ name: { en: "10% over 150", ar: "خصم ١٠٪" }, conditions: { minSubtotal: toMoney("150") } });
    await cart("t1", 2);

    const { quote, placed } = await quoteThenPlace("t1");

    expect(quote.discount).toBe("20");
    expect(quote.promotion).toMatchObject({ code: "", automatic: true, name: { en: "10% over 150", ar: "خصم ١٠٪" } });
    expect(placed.total).toBe("230"); // 200 − 20 + 50 shipping
    expect((await PromotionModel.findById(promo._id).lean())!.usageCount).toBe(1);
  });

  it.each([
    ["below its minimum subtotal", { conditions: { minSubtotal: toMoney("500") } }],
    ["inactive", { active: false }],
    ["expired", { conditions: { endsAt: new Date(Date.now() - 60_000) } }],
    ["not started", { conditions: { startsAt: new Date(Date.now() + 3_600_000) } }],
    ["used up", { limits: { totalUses: 1 }, usageCount: 1 }],
  ])("does not apply an automatic promotion that is %s", async (_label, overrides) => {
    await product("100.00");
    const promo = await automatic(overrides);
    await cart("t2", 2);

    const { quote, placed } = await quoteThenPlace("t2");

    expect(quote.discount).toBe("0");
    expect(quote).not.toHaveProperty("promotion");
    expect(placed.total).toBe("250");
    expect((await PromotionModel.findById(promo._id).lean())!.usageCount).toBe((overrides as { usageCount?: number }).usageCount ?? 0);
  });

  it("the better offer wins: an automatic 10% beats an entered 5% code, and the code is not used", async () => {
    await product("100.00");
    const code = await PromotionModel.create({ code: "FIVE", name: { en: "5%", ar: "٥٪" }, description: { en: "x", ar: "x" }, type: "PERCENT", value: toMoney("5"), conditions: {} });
    await automatic({});
    await cart("t3", 2, "FIVE");

    const { quote, placed } = await quoteThenPlace("t3");

    expect(quote.promotion).toMatchObject({ automatic: true, code: "" });
    expect(quote.discount).toBe("20");
    expect((await OrderLineModel.find({ orderId: placed.orderId }).lean()).every((line) => line.promotionCode === undefined)).toBe(true);
    expect((await PromotionModel.findById(code._id).lean())!.usageCount).toBe(0);
  });

  it("…and an entered code worth more beats the automatic one, and is the one recorded", async () => {
    await product("100.00");
    await PromotionModel.create({ code: "TWENTY", name: { en: "20%", ar: "٢٠٪" }, description: { en: "x", ar: "x" }, type: "PERCENT", value: toMoney("20"), conditions: {} });
    const auto = await automatic({});
    await cart("t4", 2, "TWENTY");

    const { quote, placed } = await quoteThenPlace("t4");

    expect(quote.promotion).toMatchObject({ automatic: false, code: "TWENTY" });
    expect(quote.discount).toBe("40");
    expect((await OrderLineModel.find({ orderId: placed.orderId }).lean()).map((line) => line.promotionCode)).toEqual(["TWENTY"]);
    expect((await PromotionModel.findById(auto._id).lean())!.usageCount).toBe(0);
  });

  it("an automatic free delivery is valued at the fee it waives — it beats a 2% discount worth less", async () => {
    await product("100.00");
    await automatic({ type: "FREE_SHIPPING", value: undefined, name: { en: "Free delivery", ar: "توصيل مجاني" } });
    await automatic({ value: toMoney("2") });
    await cart("t5", 2);

    const { quote, placed } = await quoteThenPlace("t5");

    expect(quote.promotion).toMatchObject({ waivesShippingFee: true, name: { en: "Free delivery" } });
    expect(quote.shippingFee).toBe("0");
    expect(placed.total).toBe("200");
  });

  it("never grants a GUEST an automatic promotion with a per-customer limit (a guest's uses cannot be counted; customers: promotion-identity.integration.test.ts)", async () => {
    await product("100.00");
    await automatic({ limits: { perCustomerUses: 1 } });
    await cart("t6", 2);

    const { quote } = await quoteThenPlace("t6");

    expect(quote.discount).toBe("0");
  });

  it("CONCURRENT: six guests racing for an automatic promotion with two uses left — exactly two discounts, usage never exceeds the cap", async () => {
    await product("100.00");
    const promo = await automatic({ limits: { totalUses: 2 } });
    const tokens = ["c1", "c2", "c3", "c4", "c5", "c6"];
    for (const token of tokens) await cart(token, 2);

    const results = await Promise.all(tokens.map((token) =>
      callShopRoute(ordersRoute.POST, "/api/shop/orders", {
        method: "POST",
        headers: { "x-cart-token": token, "Idempotency-Key": `race-${token}-${Math.random()}`, "x-forwarded-for": `10.0.0.${token.slice(1)}` },
        body: { paymentMethod: "COD", termsVersionAccepted: 1, guestContact: { name: "Sara", phone: "+201001112223" } },
      })
    ));

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(await OrderModel.countDocuments({})).toBe(6); // six real orders, not replays
    expect(results.filter((r) => r.body.discount !== "0")).toHaveLength(2);
    expect((await PromotionModel.findById(promo._id).lean())!.usageCount).toBe(2);
  });
});
