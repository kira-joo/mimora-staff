import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { CustomerModel } from "src/server/identity/customer.schema";
import { CartModel } from "src/server/commerce/cart.schema";
import { CartLineModel, buildCartLineIdentityKey } from "src/server/commerce/cart-line.schema";
import { OrderModel, OrderLineModel } from "src/server/commerce/order.schema";
import { OrderSequenceModel } from "src/server/commerce/order-sequence.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { PageModel } from "src/server/content/page.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { PickupLocationModel } from "src/server/fulfilment/pickup-location.schema";
import { PaymentSettingsModel } from "src/server/fulfilment/payment-settings.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { removeHarnessStaff, signInAsOwner, type AdminCaller, type RouteHandler } from "./admin/test-support/admin-route-harness";
import { callShopRoute, type ShopRouteHandler } from "./shop/test-support/shop-route-harness";

/**
 * "Stock is transactional" — but the listing's purchasable and low-stock signals are ROLLUPS shown on ISR pages, so
 * every route that moves stock must invalidate the PRODUCTS tag, and only when it really did. The factory publishes a
 * route's declared tags only after the handler returned, so each negative case below proves "never on error" too.
 *
 *   place order (shop)            -> PRODUCTS            refused placement      -> none
 *   cancel order (shop)           -> PRODUCTS
 *   status -> CANCELLED (admin)   -> PRODUCTS            any other transition   -> none
 *   expire-unpaid (admin + job)   -> PRODUCTS only when it cancelled something
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("./admin/test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const placeOrder = (await import("./shop/orders/route")).POST as ShopRouteHandler;
const customerCancel = (await import("./shop/orders/[orderNumber]/cancel/route")).POST as ShopRouteHandler;
const adminStatus = (await import("./admin/orders/[id]/status/route")).PUT as RouteHandler;
const adminExpire = (await import("./admin/orders/expire-unpaid/route")).POST as RouteHandler;
const jobRoutes = await import("./internal/jobs/expire-unpaid-orders/route");
const jobPost = jobRoutes.POST as RouteHandler;
const jobGet = jobRoutes.GET as RouteHandler;

const JOBS_SECRET = "integration-test-jobs-secret-0123456789";
const originalJobsSecret = process.env.JOBS_SECRET;
const realFetch = globalThis.fetch;
const revalidations: Array<{ tags: string[] }> = [];
let owner: AdminCaller;

const wipe = () =>
  Promise.all([
    CustomerModel.deleteMany({}),
    CartModel.deleteMany({}),
    CartLineModel.deleteMany({}),
    OrderModel.deleteMany({}),
    OrderLineModel.deleteMany({}),
    OrderSequenceModel.deleteMany({}),
    VariantModel.deleteMany({}),
    ProductModel.deleteMany({}),
    PickupLocationModel.deleteMany({}),
    FulfilmentSettingsModel.deleteMany({}),
    PaymentSettingsModel.deleteMany({}),
    PageModel.deleteMany({}),
    RateLimitModel.deleteMany({}),
  ]);

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([wipe(), removeHarnessStaff()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await wipe();
  revalidations.length = 0;
  process.env.STOREFRONT_REVALIDATE_URL = "http://storefront.test/api/revalidate";
  process.env.REVALIDATE_SECRET = "test-revalidate-secret";
  process.env.JOBS_SECRET = JOBS_SECRET;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("http://storefront.test/")) {
      revalidations.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    }
    return realFetch(url, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalJobsSecret === undefined) delete process.env.JOBS_SECRET;
  else process.env.JOBS_SECRET = originalJobsSecret;
});

/** Revalidation is published after the response is built; give a would-be (wrong) publish time to land before asserting none. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
const publishedTags = () => revalidations.map((entry) => entry.tags);

async function seedShop(stock = 10) {
  await PageModel.create({ slug: "terms", title: { en: "Terms", ar: "الشروط" }, content: { en: "Terms.", ar: "الشروط." }, published: true, version: 1 });
  await FulfilmentSettingsModel.create({ deliveryEnabled: true, pickupEnabled: true, shippingFeeMode: "FLAT", flatShippingFee: new Decimal("5.00"), defaultDispatchLeadDays: 2, cutoffTime: "14:00", orderMinimum: new Decimal("0"), customerCancelWindowMinutes: 30, tax: { mode: "INCLUDED", rate: 0 } });
  await PaymentSettingsModel.create({ methods: [{ method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false }] });
  const location = await PickupLocationModel.create({ name: { en: "Main", ar: "الرئيسي" }, address: { en: "1 St", ar: "١" }, phone: "555-0100", active: true });
  const product = await ProductModel.create({ slug: "tee", categoryId: new mongoose.Types.ObjectId(), name: { en: "Tee", ar: "قميص" }, lifecycle: "published" });
  const variant = await VariantModel.create({ productId: product._id, sku: "TEE-1", variantKey: "tee-1", stock, price: toMoney("100.00"), backorderPolicy: "DENY" });
  const customer = await CustomerModel.create({ phone: `+2010${Math.floor(Math.random() * 100000000)}`, passwordHash: "x", name: "Customer", tokenVersion: 1 });
  const cart = await CartModel.create({ customerId: customer._id, fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id } });
  return { customer, variant, cart };
}

async function fillCart(cartId: mongoose.Types.ObjectId, variantId: mongoose.Types.ObjectId, quantity: number) {
  await CartLineModel.create({ cartId, variantId, quantity, lineIdentityKey: buildCartLineIdentityKey(cartId, variantId, undefined) });
}

async function place(customerId: string) {
  return callShopRoute(placeOrder, "/api/shop/orders", { method: "POST", customerId, headers: { "Idempotency-Key": crypto.randomUUID() }, body: { paymentMethod: "COD", termsVersionAccepted: 1 } });
}

async function placedOrder(quantity = 2) {
  const shop = await seedShop();
  await fillCart(shop.cart._id, shop.variant._id, quantity);
  const response = await place(shop.customer._id.toString());
  expect(response.status).toBe(201);
  await vi.waitFor(() => expect(revalidations.length).toBeGreaterThan(0));
  revalidations.length = 0;
  return { ...shop, orderNumber: response.body.orderNumber as string, orderId: response.body.orderId as string };
}

describe("placing an order revalidates the listing", () => {
  it("declares PRODUCTS when the order committed (stock decremented)", async () => {
    const shop = await seedShop();
    await fillCart(shop.cart._id, shop.variant._id, 2);

    const response = await place(shop.customer._id.toString());

    expect(response.status).toBe(201);
    expect((await VariantModel.findById(shop.variant._id).lean())?.stock).toBe(8);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
    expect(publishedTags()).toEqual([["PRODUCTS"]]);
  });

  it("declares nothing when the order is refused (more than the stock on hand) — and stock is untouched", async () => {
    const shop = await seedShop(1);
    await fillCart(shop.cart._id, shop.variant._id, 5);

    const response = await place(shop.customer._id.toString());

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await VariantModel.findById(shop.variant._id).lean())?.stock).toBe(1);
    await settle();
    expect(revalidations).toEqual([]);
  });
});

describe("cancelling an order revalidates the listing", () => {
  it("customer cancel: stock returns and PRODUCTS is declared", async () => {
    const order = await placedOrder();
    expect((await VariantModel.findById(order.variant._id).lean())?.stock).toBe(8);

    const response = await callShopRoute(customerCancel, `/api/shop/orders/${order.orderNumber}/cancel`, { method: "POST", customerId: order.customer._id.toString(), params: { orderNumber: order.orderNumber }, body: { reason: "changed my mind" } });

    expect(response.status).toBe(200);
    expect((await VariantModel.findById(order.variant._id).lean())?.stock).toBe(10);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
    expect(publishedTags()).toEqual([["PRODUCTS"]]);
  });

  it("customer cancel of an order that cannot be cancelled declares nothing", async () => {
    const order = await placedOrder();
    await OrderModel.updateOne({ orderNumber: order.orderNumber }, { $set: { status: "DELIVERED" } });

    const response = await callShopRoute(customerCancel, `/api/shop/orders/${order.orderNumber}/cancel`, { method: "POST", customerId: order.customer._id.toString(), params: { orderNumber: order.orderNumber }, body: {} });

    expect(response.status).toBeGreaterThanOrEqual(400);
    await settle();
    expect(revalidations).toEqual([]);
  });

  it("staff status -> CANCELLED: stock returns and PRODUCTS is declared", async () => {
    const order = await placedOrder();

    const response = await owner.call(adminStatus, `/api/admin/orders/${order.orderId}/status`, { method: "PUT", params: { id: order.orderId }, body: { status: "CANCELLED", reason: "out of the colour" } });

    expect(response.status).toBe(200);
    expect((await VariantModel.findById(order.variant._id).lean())?.stock).toBe(10);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
    expect(publishedTags()).toEqual([["PRODUCTS"]]);
  });

  it("staff status -> a transition that holds the stock (CONFIRMED) declares nothing", async () => {
    const order = await placedOrder();

    const response = await owner.call(adminStatus, `/api/admin/orders/${order.orderId}/status`, { method: "PUT", params: { id: order.orderId }, body: { status: "CONFIRMED" } });

    expect(response.status).toBe(200);
    expect((await VariantModel.findById(order.variant._id).lean())?.stock).toBe(8);
    await settle();
    expect(revalidations).toEqual([]);
  });
});

describe("the unpaid-order sweep revalidates only when it cancelled something", () => {
  async function seedExpiredOrder() {
    await PaymentSettingsModel.deleteMany({});
    await PaymentSettingsModel.create({ methods: [{ method: "WALLET_TRANSFER", enabled: true, order: 0, requiresProof: true, autoCancelMinutes: 60 }] });
    return OrderModel.create({
      orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
      idempotencyKey: `k-${new mongoose.Types.ObjectId()}`,
      guestPhone: "+201000000000",
      status: "PLACED",
      placedAt: new Date(Date.now() - 3 * 60 * 60_000),
      subtotal: new Decimal("10.00"),
      total: new Decimal("10.00"),
      fulfilment: { mode: "PICKUP", fee: toMoney("0.00") },
      payment: { method: "WALLET_TRANSFER", status: "AWAITING_PAYMENT" },
      timeline: [{ type: "ORDER_PLACED", at: new Date(), actorType: "CUSTOMER" }],
    });
  }
  const jobRequest = (method: "GET" | "POST") => new NextRequest("http://localhost/api/internal/jobs/expire-unpaid-orders", { method, headers: { authorization: `Bearer ${JOBS_SECRET}` } });
  const context = { params: Promise.resolve({}) };

  it("admin sweep that cancelled an order declares PRODUCTS", async () => {
    await seedExpiredOrder();
    const response = await owner.call(adminExpire, "/api/admin/orders/expire-unpaid", { method: "POST" });
    expect((await response.json()).cancelled).toHaveLength(1);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
    expect(publishedTags()).toEqual([["PRODUCTS"]]);
  });

  it("admin sweep that found nothing declares nothing", async () => {
    await PaymentSettingsModel.create({ methods: [{ method: "WALLET_TRANSFER", enabled: true, order: 0, requiresProof: true, autoCancelMinutes: 60 }] });
    const response = await owner.call(adminExpire, "/api/admin/orders/expire-unpaid", { method: "POST" });
    expect((await response.json()).cancelled).toEqual([]);
    await settle();
    expect(revalidations).toEqual([]);
  });

  it.each([
    ["POST", jobPost],
    ["GET", jobGet],
  ] as const)("scheduled job (%s) that cancelled an order declares PRODUCTS; a second run declares nothing", async (method, handler) => {
    await seedExpiredOrder();

    const first = await handler(jobRequest(method), context);
    expect((await first.json()).cancelled).toHaveLength(1);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
    expect(publishedTags()).toEqual([["PRODUCTS"]]);

    revalidations.length = 0;
    const second = await handler(jobRequest(method), context);
    expect((await second.json()).cancelled).toEqual([]);
    await settle();
    expect(revalidations).toEqual([]);
  });
});
