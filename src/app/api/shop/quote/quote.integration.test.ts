import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { toMoney, type ImageAsset } from "@kira-joo/toolkit-common";
import { connectToDatabase } from "src/server/core/db/connect";
import { CartModel } from "src/server/commerce/cart.schema";
import { CartLineModel } from "src/server/commerce/cart-line.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { FulfilmentSettingsModel } from "src/server/fulfilment/fulfilment-settings.schema";
import { callShopRoute, type ShopRouteHandler } from "../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { POST } = (await import("./route")) as unknown as { POST: ShopRouteHandler };

const IMAGE = { provider: "cloudinary", publicId: "p1", secureUrl: "https://x/p1.jpg", format: "jpg", width: 10, height: 10, bytes: 1 } as unknown as ImageAsset;

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  await Promise.all([CartModel.deleteMany({}), CartLineModel.deleteMany({}), ProductModel.deleteMany({}), VariantModel.deleteMany({}), FulfilmentSettingsModel.deleteMany({})]);
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
    expect(Object.keys(body).sort()).toEqual(["discount", "fulfilment", "hasUnavailableLines", "lines", "shippingFee", "shippingPending", "subtotal", "tax", "total"]);
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
