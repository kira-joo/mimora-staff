import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { toMoney, type ImageAsset } from "@kira-joo/toolkit-common";
import { connectToDatabase } from "src/server/core/db/connect";
import { CartModel } from "src/server/commerce/cart.schema";
import { CartLineModel } from "src/server/commerce/cart-line.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { DeliveryZoneModel } from "src/server/fulfilment/delivery-zone.schema";
import { callShopRoute, type ShopRouteHandler } from "../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { POST } = (await import("./route")) as unknown as { POST: ShopRouteHandler };
const { PUT: setGiftWrap } = (await import("../cart/gift-wrap/route")) as unknown as { PUT: ShopRouteHandler };

const IMAGE = { provider: "cloudinary", publicId: "p1", secureUrl: "https://x/p1.jpg", format: "jpg", width: 10, height: 10, bytes: 1 } as unknown as ImageAsset;

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  await Promise.all([CartModel.deleteMany({}), CartLineModel.deleteMany({}), ProductModel.deleteMany({}), VariantModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({}), DeliveryZoneModel.deleteMany({})]);
});
afterAll(async () => {
  await mongoose.disconnect();
});

async function seedGuestCart() {
  await FulfilmentSettingsModel.create({ deliveryEnabled: true, pickupEnabled: true, defaultDispatchLeadDays: 1, shippingFeeMode: "FLAT", flatShippingFee: toMoney(5), orderMinimum: toMoney(0), tax: { mode: "INCLUDED", rate: 0 } });
  const product = await ProductModel.create({
    slug: "tee",
    categoryId: new mongoose.Types.ObjectId(),
    name: { en: "Tee", ar: "قميص" },
    lifecycle: "published",
    images: [IMAGE],
    optionAxes: [{ key: "colour", name: { en: "Colour", ar: "اللون" }, values: [{ key: "olive", label: { en: "Olive", ar: "زيتي" } }] }],
  });
  const ok = await VariantModel.create({ productId: product._id, sku: "TEE-OK", variantKey: "ok", optionValues: [{ key: "colour", value: "olive" }], price: toMoney(100), stock: 10 });
  const out = await VariantModel.create({ productId: product._id, sku: "TEE-OUT", variantKey: "out", optionValues: [{ key: "colour", value: "red" }], price: toMoney(70), stock: 0 });
  const cart = await CartModel.create({ cartToken: "guest-token-1" });
  const lines = await CartLineModel.create([
    { cartId: cart._id, variantId: ok._id, lineIdentityKey: `${cart._id}|${ok._id}|`, quantity: 2 },
    { cartId: cart._id, variantId: out._id, lineIdentityKey: `${cart._id}|${out._id}|`, quantity: 1 },
  ]);
  return { product, lines };
}

describe("POST /api/shop/quote — contract", () => {
  it("prices a guest cart without fulfilment: per-line display data, availability, shipping pending", async () => {
    const { product, lines } = await seedGuestCart();

    const { status, body } = await callShopRoute(POST, "/api/shop/quote", { method: "POST", headers: { "x-cart-token": "guest-token-1" } });

    expect(status).toBe(201);
    expect(Object.keys(body).sort()).toEqual(["discount", "fulfilment", "giftWrap", "giftWrapFee", "hasUnavailableLines", "lines", "shippingFee", "shippingPending", "subtotal", "tax", "total"]);
    expect(body).toMatchObject({ subtotal: "200", total: "200", shippingFee: null, fulfilment: null, shippingPending: true, hasUnavailableLines: true });

    const [available, unavailable] = body.lines;
    expect(available).toMatchObject({
      lineId: lines[0]!._id.toString(),
      productId: product._id.toString(),
      productSlug: "tee",
      available: true,
      sku: "TEE-OK",
      quantity: 2,
      lineTotal: "200",
      image: { publicId: "p1" },
      optionLabels: [{ axis: { en: "Colour", ar: "اللون" }, value: { en: "Olive", ar: "زيتي" } }],
    });
    expect(available).not.toHaveProperty("unavailableReason");
    expect(unavailable).toMatchObject({ available: false, unavailableReason: "INSUFFICIENT_STOCK", sku: "TEE-OUT", optionLabels: [{ axis: { en: "Colour", ar: "اللون" }, value: { en: "red", ar: "red" } }] });
  });

  it("an unknown cart token quotes as an empty cart (201), not 404/409", async () => {
    const { status, body } = await callShopRoute(POST, "/api/shop/quote", { method: "POST", headers: { "x-cart-token": "nope" } });
    expect(status).toBe(201);
    expect(body).toMatchObject({ lines: [], subtotal: "0", total: "0", shippingFee: null, fulfilment: null, shippingPending: true, hasUnavailableLines: false });
  });

  it("a guest with no cart token at all also gets the empty quote", async () => {
    const { status, body } = await callShopRoute(POST, "/api/shop/quote", { method: "POST" });
    expect(status).toBe(201);
    expect(body.lines).toEqual([]);
  });
});

describe("gift box & wrapping — PUT /api/shop/cart/gift-wrap, then the quote", () => {
  const quote = () => callShopRoute(POST, "/api/shop/quote", { method: "POST", headers: { "x-cart-token": "guest-token-1" } });
  const tick = (giftWrap: unknown) => callShopRoute(setGiftWrap, "/api/shop/cart/gift-wrap", { method: "PUT", headers: { "x-cart-token": "guest-token-1" }, body: { giftWrap } });

  it("offers it with its fee, adds it to the total once ticked, and removes it once unticked", async () => {
    await seedGuestCart();
    await FulfilmentSettingsModel.updateOne({}, { $set: { giftWrapEnabled: true, giftWrapFee: toMoney(50) } });

    const offered = await quote();
    expect(offered.body.giftWrap).toEqual({ available: true, selected: false, fee: "50" });
    expect(offered.body.total).toBe("200"); // the 2 available tees; the out-of-stock line never counts

    const ticked = await tick(true);
    expect(ticked.status).toBe(200);
    expect(ticked.body.giftWrap).toBe(true);
    const withWrap = await quote();
    expect(withWrap.body).toMatchObject({ giftWrap: { available: true, selected: true, fee: "50" }, giftWrapFee: "50", total: "250" });

    await tick(false);
    expect((await quote()).body).toMatchObject({ giftWrap: { selected: false }, giftWrapFee: "0", total: "200" });
  });

  it("is not offered while switched off — and a stale tick charges nothing", async () => {
    await seedGuestCart();
    await tick(true);
    const { body } = await quote();
    expect(body.giftWrap).toEqual({ available: false, selected: false, fee: null });
    expect(body).toMatchObject({ giftWrapFee: "0", total: "200" });
  });

  it("refuses a value that is not true or false (400)", async () => {
    await seedGuestCart();
    expect((await tick("yes")).status).toBe(400);
  });
});

describe("checkout's live governorate — POST /api/shop/quote?delivery=true&governorate=…", () => {
  const quote = (search = "") => callShopRoute(POST, `/api/shop/quote${search}`, { method: "POST", headers: { "x-cart-token": "guest-token-1" } });
  const CAIRO_SAVED = { mode: "DELIVERY", address: { recipientName: "Mona", phone: "01000000000", addressLine1: "1 Nile St", city: "Maadi", governorate: "Cairo" } };

  async function seedByZone() {
    await seedGuestCart();
    await FulfilmentSettingsModel.updateOne({}, { $set: { shippingFeeMode: "BY_ZONE" } });
    await DeliveryZoneModel.create([
      { name: { en: "Cairo", ar: "القاهرة" }, areas: ["Cairo"], fee: toMoney(110), leadDays: 5, active: true, order: 0 },
      { name: { en: "Aswan", ar: "أسوان" }, areas: ["Aswan"], fee: toMoney(135), leadDays: 5, active: true, order: 1 },
    ]);
    await CartModel.updateOne({ cartToken: "guest-token-1" }, { $set: { fulfilmentDraft: CAIRO_SAVED } });
  }

  it("without the form, the saved fulfilment prices shipping (unchanged behaviour)", async () => {
    await seedByZone();
    expect((await quote()).body).toMatchObject({ shippingFee: "110", shippingPending: false, total: "310" });
  });

  it("the governorate picked in the form wins over the saved one — before the rest of the address is filled", async () => {
    await seedByZone();
    const { status, body } = await quote("?delivery=true&governorate=Aswan");
    expect(status).toBe(201);
    expect(body).toMatchObject({ shippingFee: "135", shippingPending: false, total: "335" });
    expect(body.fulfilment).toMatchObject({ mode: "DELIVERY", zone: "Aswan" });
  });

  it("no governorate chosen yet: shipping is pending, not the fee of an address saved earlier", async () => {
    await seedByZone();
    expect((await quote("?delivery=true")).body).toMatchObject({ shippingFee: null, shippingPending: true, total: "200" });
  });

  it("a governorate the store does not deliver to leaves shipping pending instead of failing the quote", async () => {
    await seedByZone();
    const { status, body } = await quote("?delivery=true&governorate=Atlantis");
    expect(status).toBe(201);
    expect(body).toMatchObject({ shippingPending: true, total: "200" });
  });

  it("the preview writes nothing: the cart keeps its saved fulfilment", async () => {
    await seedByZone();
    await quote("?delivery=true&governorate=Aswan");
    const cart = await CartModel.findOne({ cartToken: "guest-token-1" }).lean();
    expect(cart?.fulfilmentDraft?.address?.governorate).toBe("Cairo");
  });
});
