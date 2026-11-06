import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import { connectToDatabase } from "src/server/core/db/connect";
import { customerJwtConfig } from "src/server/core/auth/customer-jwt-config";
import { CUSTOMER_SESSION_COOKIE } from "src/server/core/auth/customer-session-cookies";
import { CustomerModel } from "src/server/identity/customer.schema";
import { CartModel } from "src/server/commerce/cart.schema";
import { CartLineModel, buildCartLineIdentityKey } from "src/server/commerce/cart-line.schema";
import { OrderModel, OrderLineModel } from "src/server/commerce/order.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { PickupLocationModel } from "src/server/fulfilment/pickup-location.schema";
import { PaymentSettingsModel } from "src/server/fulfilment/payment-settings.schema";
import { OrderSequenceModel } from "src/server/commerce/order-sequence.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { deriveOrderAccessToken } from "src/server/shop/order/order-access-token";
import { PageModel } from "src/server/content/page.schema";
import { DeliveryZoneModel } from "src/server/fulfilment/delivery-zone.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
// Must be set before `./route` is imported: `route-factories.ts` configures
// the whole toolkit (staff audience) as an import-time side effect, and a
// missing/short secret throws at that point, not on first request — see
// `toolkit.config.ts`'s own boot-time check. A dynamic import after this
// assignment (rather than a static one above) is what makes the ordering
// actually hold, since static imports evaluate before any of this file's
// own top-level statements run.
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { GET, POST } = await import("./route");

/** The one method the cleanup calls; the models here are a mixed list, so no single `Model<T>` fits them all. */
interface DeleteManyModel {
  deleteMany(filter: Record<string, never>): Promise<unknown>;
}

async function createCustomer() {
  return CustomerModel.create({
    phone: `+2010${Math.floor(Math.random() * 100000000)}`,
    passwordHash: "irrelevant-for-this-test",
    name: "Test Customer",
    tokenVersion: 1,
  });
}

async function customerCookieHeader(customerId: string): Promise<Record<string, string>> {
  const token = await signAuthToken({ sub: customerId, tokenVersion: 1 }, undefined, customerJwtConfig());
  return { cookie: `${CUSTOMER_SESSION_COOKIE}=${token}` };
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

  return variant;
}

async function createPickupLocation() {
  return PickupLocationModel.create({
    name: { en: "Main Store", ar: "المتجر الرئيسي" },
    address: { en: "123 Main St", ar: "١٢٣ الشارع الرئيسي" },
    phone: "555-0100",
    active: true,
  });
}

async function createPaymentSettings() {
  return PaymentSettingsModel.create({
    methods: [{ method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false }],
  });
}

// One connect/disconnect pair for the whole file — `connectToDatabase()`
// memoises its connection on `globalThis` and never clears that cache on
// `mongoose.disconnect()`, so a second `beforeAll` in a later `describe`
// would see the stale cached (now-disconnected) connection and never
// actually reconnect.
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

describe("POST /api/shop/orders - place order", () => {
  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await CartModel.deleteMany({});
    await CartLineModel.deleteMany({});
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await VariantModel.deleteMany({});
    await ProductModel.deleteMany({});
    await PickupLocationModel.deleteMany({});
    await FulfilmentSettingsModel.deleteMany({});
    await PaymentSettingsModel.deleteMany({});
    // This route calls the real placement engine, which allocates from the
    // shared, merchant-wide OrderSequenceModel counter — reset it too, or a
    // later test file sharing this database sees a stale sequence.
    await OrderSequenceModel.deleteMany({});
    // D-13: placement requires published terms to accept.
    await PageModel.deleteMany({});
    await RateLimitModel.deleteMany({});
    await PageModel.create({ slug: "terms", title: { en: "Terms", ar: "الشروط" }, content: { en: "Terms.", ar: "الشروط." }, published: true, version: 1 });
  });

  it("places order successfully and returns PlaceOrderView", async () => {
    const customer = await createCustomer();
    const variant = await createProductAndVariant("SKU-001", "100.00");
    const location = await createPickupLocation();
    await createFulfilmentSettings();
    await createPaymentSettings();

    const cart = await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id },
    });
    await CartLineModel.create({
      cartId: cart._id,
      variantId: variant._id,
      quantity: 2,
      lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined),
    });

    const request = new NextRequest("http://localhost/api/shop/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "test-key-1", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({ paymentMethod: "COD", termsVersionAccepted: 1 }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.orderNumber).toMatch(/^ORD-\d{6}$/);
    expect(body.status).toBe("PLACED");
    expect(body.paymentStatus).toBe("NOT_REQUIRED");
    expect(new Decimal(body.subtotal).toFixed(2)).toBe("200.00");
    expect(new Decimal(body.total).toFixed(2)).toBe("200.00");
  });

  it("returns 400 naming guestContact when a guest sends none (a guest is a legitimate actor now, not a 401)", async () => {
    const request = new NextRequest("http://localhost/api/shop/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "test-key-2", "x-cart-token": "any" },
      body: JSON.stringify({ paymentMethod: "COD", termsVersionAccepted: 1 }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("guestContact");
  });

  it("returns cached response on idempotent replay", async () => {
    const customer = await createCustomer();
    const variant = await createProductAndVariant("SKU-002", "50.00");
    const location = await createPickupLocation();
    await createFulfilmentSettings();
    await createPaymentSettings();

    const cart = await CartModel.create({
      customerId: customer._id,
      fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id },
    });
    await CartLineModel.create({
      cartId: cart._id,
      variantId: variant._id,
      quantity: 1,
      lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined),
    });

    const cookie = await customerCookieHeader(customer._id.toString());
    const makeRequest = () =>
      new NextRequest("http://localhost/api/shop/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "replay-key", ...cookie },
        body: JSON.stringify({ paymentMethod: "COD", termsVersionAccepted: 1 }),
      });

    const response1 = await POST(makeRequest(), { params: Promise.resolve({}) });
    const body1 = await response1.json();
    expect(response1.status).toBe(201);

    // Replay same key
    const response2 = await POST(makeRequest(), { params: Promise.resolve({}) });
    const body2 = await response2.json();

    expect(response2.status).toBe(201);
    expect(body2.orderNumber).toBe(body1.orderNumber);

    // Only one order should exist
    const orderCount = await OrderModel.countDocuments({ customerId: customer._id });
    expect(orderCount).toBe(1);
  });

  it("returns 400 naming the field when the accepted terms version is missing", async () => {
    const customer = await createCustomer();
    const request = new NextRequest("http://localhost/api/shop/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "test-key-noterms", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({ paymentMethod: "COD" }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("termsVersionAccepted");
  });

  it("returns 409 with the live version when the accepted terms are stale", async () => {
    const customer = await createCustomer();
    const variant = await createProductAndVariant("SKU-STALE", "100.00");
    const location = await createPickupLocation();
    await createFulfilmentSettings();
    await createPaymentSettings();
    const cart = await CartModel.create({ customerId: customer._id, fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id } });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });
    await PageModel.updateOne({ slug: "terms" }, { $set: { version: 3 } });

    const request = new NextRequest("http://localhost/api/shop/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "test-key-stale", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({ paymentMethod: "COD", termsVersionAccepted: 1 }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(409);
    expect(body).toContain("TERMS_VERSION_CHANGED");
    expect(body).toContain('"currentVersion":3');
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("returns 400 when the Idempotency-Key header is missing", async () => {
    const customer = await createCustomer();

    const request = new NextRequest("http://localhost/api/shop/orders", {
      method: "POST",
      headers: { "content-type": "application/json", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({ paymentMethod: "COD", termsVersionAccepted: 1 }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
  });

  it("returns 404 when cart does not exist", async () => {
    const customer = await createCustomer();

    const request = new NextRequest("http://localhost/api/shop/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "test-key-3", ...(await customerCookieHeader(customer._id.toString())) },
      body: JSON.stringify({ paymentMethod: "COD", termsVersionAccepted: 1 }),
    });

    const response = await POST(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(404);
  });
});

describe("POST /api/shop/orders - guest placement", () => {
  const GUEST_TOKEN = "guest-cart-token-abc";
  const CONTACT = { name: "  Sara  ", phone: " +201001112223 ", email: "sara@example.com" };

  beforeEach(async () => {
    await Promise.all([CustomerModel, CartModel, CartLineModel, OrderModel, OrderLineModel, VariantModel, ProductModel, PickupLocationModel, FulfilmentSettingsModel, PaymentSettingsModel, OrderSequenceModel, PageModel, RateLimitModel].map((model) => (model as unknown as DeleteManyModel).deleteMany({})));
    await PageModel.create({ slug: "terms", title: { en: "Terms", ar: "الشروط" }, content: { en: "Terms.", ar: "الشروط." }, published: true, version: 1 });
  });

  async function seedGuestCart(settingsOverrides: Record<string, unknown> = {}) {
    const variant = await createProductAndVariant("SKU-G1", "100.00");
    const location = await createPickupLocation();
    await FulfilmentSettingsModel.create({
      deliveryEnabled: true, pickupEnabled: true, shippingFeeMode: "FLAT", flatShippingFee: new Decimal("5.00"),
      defaultDispatchLeadDays: 2, cutoffTime: "14:00", orderMinimum: new Decimal("0"), customerCancelWindowMinutes: 30,
      tax: { mode: "INCLUDED", rate: 0 }, ...settingsOverrides,
    });
    await createPaymentSettings();
    const cart = await CartModel.create({ cartToken: GUEST_TOKEN, fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id } });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });
    return { cart, variant };
  }

  const place = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    POST(
      new NextRequest("http://localhost/api/shop/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": `g-${Math.random()}`, "x-cart-token": GUEST_TOKEN, ...headers },
        body: JSON.stringify({ paymentMethod: "COD", termsVersionAccepted: 1, ...body }),
      }),
      { params: Promise.resolve({}) }
    );

  it("places a guest order: persists trimmed contact, no customerId, returns the access token, clears the cart", async () => {
    const { cart } = await seedGuestCart();

    const response = await place({ guestContact: CONTACT });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.accessToken).toBe(deriveOrderAccessToken(body.orderId));
    expect(Object.keys(body).sort()).toEqual(["accessToken", "discount", "orderId", "orderNumber", "paymentStatus", "promisedWindow", "status", "subtotal", "tax", "total"]);

    const order = await OrderModel.findOne({ orderNumber: body.orderNumber }).lean();
    expect(order?.customerId).toBeUndefined();
    expect(order).toMatchObject({ guestName: "Sara", guestPhone: "+201001112223", guestEmail: "sara@example.com" });
    expect(await CartLineModel.countDocuments({ cartId: cart._id })).toBe(0);
  });

  it("snapshots the payment destination and instructions onto the order at placement", async () => {
    await seedGuestCart();
    await PaymentSettingsModel.updateOne({}, { $set: { methods: [{ method: "COD", enabled: true, order: 0, requiresProof: false, requiresProviderIntegration: false, destination: { accountName: "Shop", number: "99" }, instructions: { en: "Pay on delivery", ar: "ادفع عند الاستلام" } }] } });

    const body = await (await place({ guestContact: CONTACT })).json();

    const order = await OrderModel.findOne({ orderNumber: body.orderNumber }).lean();
    expect(order?.payment.destinationSnapshot).toMatchObject({ accountName: "Shop", number: "99" });
    expect(order?.payment.instructionsSnapshot).toMatchObject({ en: "Pay on delivery", ar: "ادفع عند الاستلام" });
  });

  it("snapshots the delivery zone in the order's language: Arabic for an Arabic order, English for an English one", async () => {
    for (const [language, expected] of [["ar", "القاهرة الكبرى"], ["en", "Greater Cairo"]] as const) {
      await Promise.all([CartModel, CartLineModel, OrderModel, OrderLineModel, VariantModel, ProductModel, PickupLocationModel, FulfilmentSettingsModel, PaymentSettingsModel, DeliveryZoneModel].map((model) => (model as unknown as DeleteManyModel).deleteMany({})));
      const { cart } = await seedGuestCart({ shippingFeeMode: "BY_ZONE" });
      await DeliveryZoneModel.create({ name: { en: "Greater Cairo", ar: "القاهرة الكبرى" }, areas: ["Maadi"], fee: new Decimal("75"), leadDays: 1, active: true, order: 0 });
      // The storefront submits the zone's ENGLISH name as the matching key, whatever the page language.
      await CartModel.updateOne({ _id: cart._id }, { $set: { fulfilmentDraft: { mode: "DELIVERY", address: { recipientName: "سارة", phone: "+201001112223", addressLine1: "٩ شارع", city: "المعادي", governorate: "Greater Cairo" } } } });

      const response = await place({ guestContact: CONTACT }, { "accept-language": language });
      expect(response.status).toBe(201);
      const order = await OrderModel.findOne({ orderNumber: (await response.json()).orderNumber }).lean();
      expect(order?.fulfilment.addressSnapshot?.governorate).toBe(expected);
      expect(order?.fulfilment.zone).toBe(expected);
      expect(Number(order?.fulfilment.fee.toString())).toBe(75);
    }
  });

  it("leaves an existing order's zone snapshot exactly as it was stored", async () => {
    const { cart } = await seedGuestCart({ shippingFeeMode: "BY_ZONE" });
    await DeliveryZoneModel.create({ name: { en: "Greater Cairo", ar: "القاهرة الكبرى" }, areas: ["Maadi"], fee: new Decimal("75"), leadDays: 1, active: true, order: 0 });
    await CartModel.updateOne({ _id: cart._id }, { $set: { fulfilmentDraft: { mode: "DELIVERY", address: { recipientName: "Sara", phone: "+201001112223", addressLine1: "9 St", city: "Maadi", governorate: "Greater Cairo" } } } });
    const placed = await (await place({ guestContact: CONTACT }, { "accept-language": "en" })).json();
    // Renaming the zone afterwards must not reach back into the order (snapshotted, not referenced).
    await DeliveryZoneModel.updateOne({}, { $set: { name: { en: "Cairo Metro", ar: "القاهرة" } } });
    const order = await OrderModel.findOne({ orderNumber: placed.orderNumber }).lean();
    expect(order?.fulfilment.zone).toBe("Greater Cairo");
    expect(order?.fulfilment.addressSnapshot?.governorate).toBe("Greater Cairo");
  });

  it("a customer's response carries no accessToken", async () => {
    const customer = await createCustomer();
    const variant = await createProductAndVariant("SKU-C1", "10.00");
    const location = await createPickupLocation();
    await createFulfilmentSettings();
    await createPaymentSettings();
    const cart = await CartModel.create({ customerId: customer._id, fulfilmentDraft: { mode: "PICKUP", pickupLocationId: location._id } });
    await CartLineModel.create({ cartId: cart._id, variantId: variant._id, quantity: 1, lineIdentityKey: buildCartLineIdentityKey(cart._id, variant._id, undefined) });

    const response = await place({}, { ...(await customerCookieHeader(customer._id.toString())), "x-cart-token": "" });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).not.toHaveProperty("accessToken");
  });

  it("rejects a customer who sends guestContact (400) and places nothing", async () => {
    const customer = await createCustomer();
    const response = await place({ guestContact: CONTACT }, await customerCookieHeader(customer._id.toString()));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("guestContact");
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it.each([
    [{ name: "", phone: "+201001112223" }, "guestContact.name"],
    [{ name: "Sara", phone: "123" }, "guestContact.phone"],
    [{ name: "Sara", phone: "+201001112223", email: "not-an-email" }, "guestContact.email"],
  ])("rejects invalid guestContact %j with a %s field error", async (guestContact, field) => {
    await seedGuestCart();
    const response = await place({ guestContact });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(field);
  });

  it("answers 401 'Sign in to continue.' when the store disallows guest checkout", async () => {
    await seedGuestCart({ allowGuestCheckout: false });
    const response = await place({ guestContact: CONTACT });
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).toContain("Sign in to continue.");
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("is 404 for a guest whose token names no cart, and for a guest with no token", async () => {
    await seedGuestCart();
    expect((await place({ guestContact: CONTACT }, { "x-cart-token": "unknown-token" })).status).toBe(404);
    expect((await place({ guestContact: CONTACT }, { "x-cart-token": "" })).status).toBe(404);
  });

  it("replays idempotently with the same token, one order, and the raw cart token never lands in the idempotency key", async () => {
    await seedGuestCart();
    // Unique per run: idempotency records outlive a test run in the shared test database.
    const headers = { "Idempotency-Key": `guest-replay-${new mongoose.Types.ObjectId()}` };

    const firstResponse = await place({ guestContact: CONTACT }, headers);
    const first = await firstResponse.json();
    expect(firstResponse.status, JSON.stringify(first)).toBe(201);
    const replay = await place({ guestContact: CONTACT }, headers);
    const second = await replay.json();

    expect(replay.status).toBe(201);
    expect(second.orderNumber).toBe(first.orderNumber);
    expect(second.accessToken).toBe(first.accessToken);
    expect(await OrderModel.countDocuments({})).toBe(1);
    const order = await OrderModel.findOne({}).lean();
    expect(order?.idempotencyKey).not.toContain(GUEST_TOKEN);
  });

  it("does not use first-order promotion eligibility for a guest, and never mentions an account owning the phone", async () => {
    await seedGuestCart();
    await CustomerModel.create({ phone: CONTACT.phone.trim(), passwordHash: "x", name: "Existing" });

    const response = await place({ guestContact: CONTACT });
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(201);
    expect(text.toLowerCase()).not.toContain("account");
    expect((await OrderModel.findOne({}).lean())?.customerId).toBeUndefined();
  });

  it("rate limits order placement by IP", async () => {
    await seedGuestCart();
    let last = 201;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      last = (await place({ guestContact: CONTACT }, { "x-forwarded-for": "8.8.8.8", "x-cart-token": "unknown-token" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("GET /api/shop/orders - list orders", () => {
  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
  });

  function pickupOrder(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
      fulfilment: { mode: "PICKUP" as const, fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
      payment: { method: "COD", status: "NOT_REQUIRED" as const },
      discount: new Decimal("0"),
      tax: new Decimal("0"),
      ...overrides,
    };
  }

  it("returns customer's orders sorted by placedAt descending", async () => {
    const customer = await createCustomer();

    await OrderModel.create({
      orderNumber: "ORD-008001",
      customerId: customer._id,
      status: "PLACED",
      placedAt: new Date("2024-01-01"),
      subtotal: new Decimal("100.00"),
      total: new Decimal("100.00"),
      ...pickupOrder(),
    });

    const order2 = await OrderModel.create({
      orderNumber: "ORD-008002",
      customerId: customer._id,
      status: "DELIVERED",
      placedAt: new Date("2024-01-02"),
      subtotal: new Decimal("200.00"),
      total: new Decimal("200.00"),
      ...pickupOrder({ payment: { method: "COD", status: "VERIFIED" } }),
    });

    await OrderLineModel.create({
      orderId: order2._id,
      lineNumber: 1,
      variantId: order2._id,
      sku: "SKU",
      productName: "Product",
      variantDescription: "Default",
      quantity: 1,
      unitPrice: new Decimal("200"),
      lineTotal: new Decimal("200"),
    });

    const request = new NextRequest("http://localhost/api/shop/orders", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].orderNumber).toBe("ORD-008002"); // most recent
    expect(body[0].itemCount).toBe(1);
    expect(body[1].orderNumber).toBe("ORD-008001");
  });

  it("returns 401 when no auth cookie is present", async () => {
    const request = new NextRequest("http://localhost/api/shop/orders");

    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
  });

  it("isolates orders by customer", async () => {
    const customer1 = await createCustomer();
    const customer2 = await createCustomer();

    await OrderModel.create({
      orderNumber: "ORD-008003",
      customerId: customer1._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("50.00"),
      total: new Decimal("50.00"),
      ...pickupOrder(),
    });

    await OrderModel.create({
      orderNumber: "ORD-008004",
      customerId: customer2._id,
      status: "PLACED",
      placedAt: new Date(),
      subtotal: new Decimal("75.00"),
      total: new Decimal("75.00"),
      ...pickupOrder(),
    });

    const request = new NextRequest("http://localhost/api/shop/orders", {
      headers: await customerCookieHeader(customer1._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].orderNumber).toBe("ORD-008003");
  });

  it("respects limit and offset query parameters", async () => {
    const customer = await createCustomer();

    for (let i = 1; i <= 5; i++) {
      await OrderModel.create({
        orderNumber: `ORD-008${String(100 + i)}`,
        customerId: customer._id,
        status: "PLACED",
        placedAt: new Date(`2024-01-0${i}`),
        subtotal: new Decimal("100.00"),
        total: new Decimal("100.00"),
        ...pickupOrder(),
      });
    }

    const request = new NextRequest("http://localhost/api/shop/orders?limit=2&offset=1", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].orderNumber).toBe("ORD-008104");
    expect(body[1].orderNumber).toBe("ORD-008103");
  });
});
