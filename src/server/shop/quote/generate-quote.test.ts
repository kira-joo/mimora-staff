// @vitest-environment node
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { ZERO, toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { VariantModel } from "../../catalog/variant.schema";
import { ProductModel } from "../../catalog/product.schema";
import { CartModel } from "../../commerce/cart.schema";
import { CartLineModel } from "../../commerce/cart-line.schema";
import { PromotionModel } from "../../commerce/promotion.schema";
import { DeliveryZoneModel } from "../../fulfilment/delivery-zone.schema";
import { FulfilmentSettingsModel } from "../../fulfilment/fulfilment-settings.schema";
import { PickupLocationModel } from "../../fulfilment/pickup-location.schema";
import { connectToDatabase } from "../../core/db/connect";
import { generateQuote } from "./generate-quote";
import type { ShopActor } from "../shop-actor";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("generateQuote", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      CartModel.deleteMany({}),
      CartLineModel.deleteMany({}),
      VariantModel.deleteMany({}),
      ProductModel.deleteMany({}),
      PromotionModel.deleteMany({}),
      FulfilmentSettingsModel.deleteMany({}),
      DeliveryZoneModel.deleteMany({}),
      PickupLocationModel.deleteMany({}),
    ]);
  });

  describe("Happy Path", () => {
    it("generates quote for valid cart with single line - DELIVERY", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 2,
        shippingFeeMode: "BY_ZONE",
        orderMinimum: toMoney(50),
        tax: { mode: "ADDED", rate: 14 },
      });

      await DeliveryZoneModel.create({
        name: { en: "Cairo", ar: "القاهرة" },
        areas: ["Cairo"],
        fee: toMoney(30),
        minimumOrder: toMoney(100),
        leadDays: 3,
        active: true,
      });

      const product = await ProductModel.create({
        name: { en: "Test Product", ar: "منتج تجريبي" },
        slug: "test-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "TEST-001",
        variantKey: `${product._id}|`,
        price: toMoney(200),
        stock: 10,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "John Doe",
            phone: "+201234567890",
            addressLine1: "123 Test St",
            city: "Cairo",
            governorate: "Cairo",
          },
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 2,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({
        actor,
        locale: "en",
        now: new Date("2026-01-15T10:00:00Z"),
      });

      expect(quote.lines).toHaveLength(1);
      expect(quote.lines[0].sku).toBe("TEST-001");
      expect(quote.lines[0].quantity).toBe(2);
      expect(quote.lines[0].unitPrice.toString()).toBe("200");
      expect(quote.lines[0].lineTotal.toString()).toBe("400");
      expect(quote.subtotal.toString()).toBe("400");
      expect(quote.discount.toString()).toBe("0");
      expect(quote.shippingFee!.toString()).toBe("30");
      expect(quote.tax.toString()).toBe("60.2"); // (400 + 30) * 0.14
      expect(quote.total.toString()).toBe("490.2"); // 400 + 30 + 60.2
      expect(quote.fulfilment!.mode).toBe("DELIVERY");
      expect(quote.fulfilment!.zone).toBe("Cairo");
    });

    it("generates quote for valid cart with multiple lines", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: true,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "FLAT",
        flatShippingFee: toMoney(25),
        orderMinimum: ZERO,
        tax: { mode: "INCLUDED", rate: 14 },
      });

      const product1 = await ProductModel.create({
        name: { en: "Product 1", ar: "منتج 1" },
        slug: "product-1",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const product2 = await ProductModel.create({
        name: { en: "Product 2", ar: "منتج 2" },
        slug: "product-2",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant1 = await VariantModel.create({
        productId: product1._id,
        sku: "P1-SKU",
        variantKey: `${product1._id}|Size=Small`,
        price: toMoney(100),
        stock: 5,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [{ key: "Size", value: "Small" }],
      });

      const variant2 = await VariantModel.create({
        productId: product2._id,
        sku: "P2-SKU",
        variantKey: `${product2._id}|Color=Red`,
        price: toMoney(150),
        stock: 8,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [{ key: "Color", value: "Red" }],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "Jane Doe",
            phone: "+201234567890",
            addressLine1: "456 Test Ave",
            city: "Giza",
            governorate: "Giza",
          },
        },
      });

      await CartLineModel.create([
        { cartId: cart._id, variantId: variant1._id, lineIdentityKey: `${cart._id}|${variant1._id}|`, quantity: 1 },
        { cartId: cart._id, variantId: variant2._id, lineIdentityKey: `${cart._id}|${variant2._id}|`, quantity: 3 },
      ]);

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({
        actor,
        locale: "en",
        now: new Date("2026-01-15T10:00:00Z"),
      });

      expect(quote.lines).toHaveLength(2);
      // A quote promises no line order (cart lines are read unsorted, and these two
      // were inserted in parallel), so each line is matched by its own variant.
      const byDescription = new Map(quote.lines.map((line) => [line.variantDescription, line]));
      expect([...byDescription.keys()].sort()).toEqual(["Red", "Small"]);
      expect(byDescription.get("Small")!.quantity).toBe(1);
      expect(byDescription.get("Red")!.quantity).toBe(3);
      expect(quote.subtotal.toString()).toBe("550"); // 100 + 450
      expect(quote.shippingFee!.toString()).toBe("25");
      // Tax INCLUDED: extract tax from (550 + 25)
      const taxableBase = toMoney(575);
      const divisor = toMoney(14).div(100).plus(1); // 1.14
      const expectedTax = taxableBase.minus(taxableBase.div(divisor));
      expect(quote.tax.toString()).toBe(expectedTax.toFixed(2));
      expect(quote.total.toString()).toBe("575"); // tax already included
    });

    it("generates quote for PICKUP fulfilment - zero fee", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: false,
        pickupEnabled: true,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "BY_ZONE",
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 0 },
      });

      const pickupLocation = await PickupLocationModel.create({
        name: { en: "Main Store", ar: "المتجر الرئيسي" },
        address: { en: "123 Main St", ar: "123 شارع الرئيسي" },
        phone: "+201234567890",
        active: true,
      });

      const product = await ProductModel.create({
        name: { en: "Pickup Product", ar: "منتج للاستلام" },
        slug: "pickup-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "PICKUP-001",
        variantKey: `${product._id}|`,
        price: toMoney(300),
        stock: 20,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        cartToken: "guest-cart-token-123",
        fulfilmentDraft: {
          mode: "PICKUP",
          pickupLocationId: pickupLocation._id,
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "guest", cartToken: "guest-cart-token-123" };

      const quote = await generateQuote({
        actor,
        locale: "en",
        now: new Date("2026-01-15T10:00:00Z"),
      });

      expect(quote.subtotal.toString()).toBe("300");
      expect(quote.shippingFee!.toString()).toBe("0");
      expect(quote.tax.toString()).toBe("0");
      expect(quote.total.toString()).toBe("300");
      expect(quote.fulfilment!.mode).toBe("PICKUP");
      expect(quote.fulfilment!.fee.toString()).toBe("0");
    });

    it("applies valid promotion correctly", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 2,
        shippingFeeMode: "FLAT",
        flatShippingFee: toMoney(20),
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 14 },
      });

      await PromotionModel.create({
        code: "SAVE20",
        type: "PERCENT",
        value: toMoney("20"),
        active: true,
        conditions: {
          minSubtotal: toMoney(100),
          categories: [],
          collections: [],
          products: [],
          variants: [],
          firstOrderOnly: false,
        },
        limits: {},
        usageCount: 0,
        stackable: false,
      });

      const product = await ProductModel.create({
        name: { en: "Promo Product", ar: "منتج العرض" },
        slug: "promo-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "PROMO-001",
        variantKey: `${product._id}|`,
        price: toMoney(500),
        stock: 10,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        appliedPromotionCode: "SAVE20",
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "John Doe",
            phone: "+201234567890",
            addressLine1: "123 Test St",
            city: "Cairo",
            governorate: "Cairo",
          },
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({
        actor,
        locale: "en",
        now: new Date("2026-01-15T10:00:00Z"),
      });

      expect(quote.subtotal.toString()).toBe("500");
      expect(quote.discount.toString()).toBe("100"); // 20% of 500
      expect(quote.promotion).toBeDefined();
      expect(quote.promotion!.code).toBe("SAVE20");
      expect(quote.promotion!.subtotalDiscount.toString()).toBe("100");
      expect(quote.shippingFee!.toString()).toBe("20");
      const taxableBase = toMoney(400).plus(toMoney(20)); // (500 - 100) + 20
      const expectedTax = taxableBase.mul(14).div(100);
      expect(quote.tax.toString()).toBe(expectedTax.toString());
      expect(quote.total.toString()).toBe(toMoney(400).plus(toMoney(20)).plus(expectedTax).toString());
    });
  });

  describe("Invalid Cart", () => {
    it("quotes an absent cart as empty at zero rather than failing", async () => {
      const actor: ShopActor = { kind: "customer", customer: { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({ actor, locale: "en", now: new Date("2026-01-15T10:00:00Z") });
      expect(quote.lines).toEqual([]);
      expect(quote.total.toString()).toBe("0");
      expect(quote.shippingFee).toBeNull();
      expect(quote.fulfilment).toBeNull();
      expect(quote.shippingPending).toBe(true);
      expect(quote.hasUnavailableLines).toBe(false);
    });

    it("quotes an empty cart as empty at zero rather than failing", async () => {
      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "John Doe",
            phone: "+201234567890",
            addressLine1: "123 Test St",
            city: "Cairo",
            governorate: "Cairo",
          },
        },
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({ actor, locale: "en", now: new Date("2026-01-15T10:00:00Z") });
      expect(quote.lines).toEqual([]);
      expect(quote.subtotal.toString()).toBe("0");
      expect(quote.shippingPending).toBe(true);
    });
  });

  describe("Unavailable Product/Variant", () => {
    it("flags a discontinued line unavailable and excludes it from totals", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "FLAT",
        flatShippingFee: ZERO,
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 0 },
      });

      const product = await ProductModel.create({
        name: { en: "Test Product", ar: "منتج تجريبي" },
        slug: "test-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "DISCONTINUED-001",
        variantKey: `${product._id}|`,
        price: toMoney(100),
        stock: 5,
        backorderPolicy: "DENY",
        discontinued: true,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "John Doe",
            phone: "+201234567890",
            addressLine1: "123 Test St",
            city: "Cairo",
            governorate: "Cairo",
          },
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({ actor, locale: "en", now: new Date("2026-01-15T10:00:00Z") });
      expect(quote.lines[0]).toMatchObject({ available: false, unavailableReason: "DISCONTINUED" });
      expect(quote.hasUnavailableLines).toBe(true);
      expect(quote.total.toString()).toBe("0");
    });

    it("flags an out-of-stock DENY line unavailable (INSUFFICIENT_STOCK), not a failed quote", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "FLAT",
        flatShippingFee: ZERO,
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 0 },
      });

      const product = await ProductModel.create({
        name: { en: "Test Product", ar: "منتج تجريبي" },
        slug: "test-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "OOS-001",
        variantKey: `${product._id}|`,
        price: toMoney(100),
        stock: 0,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "John Doe",
            phone: "+201234567890",
            addressLine1: "123 Test St",
            city: "Cairo",
            governorate: "Cairo",
          },
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({ actor, locale: "en", now: new Date("2026-01-15T10:00:00Z") });
      expect(quote.lines[0]).toMatchObject({ available: false, unavailableReason: "INSUFFICIENT_STOCK" });
      expect(quote.hasUnavailableLines).toBe(true);
      expect(quote.subtotal.toString()).toBe("0");
    });

    it("flags a line of an archived product unavailable (NOT_PUBLISHED), not a failed quote", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "FLAT",
        flatShippingFee: ZERO,
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 0 },
      });

      const product = await ProductModel.create({
        name: { en: "Archived Product", ar: "منتج مؤرشف" },
        slug: "archived-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "archived",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "ARCHIVED-001",
        variantKey: `${product._id}|`,
        price: toMoney(100),
        stock: 10,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "John Doe",
            phone: "+201234567890",
            addressLine1: "123 Test St",
            city: "Cairo",
            governorate: "Cairo",
          },
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({ actor, locale: "en", now: new Date("2026-01-15T10:00:00Z") });
      expect(quote.lines[0]).toMatchObject({ available: false, unavailableReason: "NOT_PUBLISHED" });
      expect(quote.hasUnavailableLines).toBe(true);
      expect(quote.subtotal.toString()).toBe("0");
    });
  });

  describe("Promotion", () => {
    it("silently excludes expired promotion from quote", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "FLAT",
        flatShippingFee: ZERO,
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 0 },
      });

      await PromotionModel.create({
        code: "EXPIRED",
        type: "FIXED",
        value: toMoney("50"),
        active: true,
        conditions: {
          endsAt: new Date("2026-01-01T00:00:00Z"),
          categories: [],
          collections: [],
          products: [],
          variants: [],
          firstOrderOnly: false,
        },
        limits: {},
        usageCount: 0,
        stackable: false,
      });

      const product = await ProductModel.create({
        name: { en: "Test Product", ar: "منتج تجريبي" },
        slug: "test-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "TEST-001",
        variantKey: `${product._id}|`,
        price: toMoney(200),
        stock: 10,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        appliedPromotionCode: "EXPIRED",
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "John Doe",
            phone: "+201234567890",
            addressLine1: "123 Test St",
            city: "Cairo",
            governorate: "Cairo",
          },
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({
        actor,
        locale: "en",
        now: new Date("2026-01-15T10:00:00Z"),
      });

      expect(quote.discount.toString()).toBe("0");
      expect(quote.promotion).toBeUndefined();
      expect(quote.total.toString()).toBe("200");
    });

    it("silently excludes promotion that hit usage limit", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "FLAT",
        flatShippingFee: ZERO,
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 0 },
      });

      await PromotionModel.create({
        code: "LIMITED",
        type: "FIXED",
        value: toMoney("30"),
        active: true,
        conditions: {
          categories: [],
          collections: [],
          products: [],
          variants: [],
          firstOrderOnly: false,
        },
        limits: { totalUses: 100 },
        usageCount: 100,
        stackable: false,
      });

      const product = await ProductModel.create({
        name: { en: "Test Product", ar: "منتج تجريبي" },
        slug: "test-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "TEST-001",
        variantKey: `${product._id}|`,
        price: toMoney(150),
        stock: 10,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        appliedPromotionCode: "LIMITED",
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "John Doe",
            phone: "+201234567890",
            addressLine1: "123 Test St",
            city: "Cairo",
            governorate: "Cairo",
          },
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({
        actor,
        locale: "en",
        now: new Date("2026-01-15T10:00:00Z"),
      });

      expect(quote.discount.toString()).toBe("0");
      expect(quote.promotion).toBeUndefined();
    });
  });

  describe("Shipping", () => {
    it("quotes without a fulfilment draft: shipping pending, total excludes it", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "FLAT",
        flatShippingFee: ZERO,
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 0 },
      });

      const product = await ProductModel.create({
        name: { en: "Test Product", ar: "منتج تجريبي" },
        slug: "test-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "TEST-001",
        variantKey: `${product._id}|`,
        price: toMoney(100),
        stock: 10,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      const quote = await generateQuote({ actor, locale: "en", now: new Date("2026-01-15T10:00:00Z") });
      expect(quote.subtotal.toString()).toBe("100");
      expect(quote.shippingFee).toBeNull();
      expect(quote.fulfilment).toBeNull();
      expect(quote.shippingPending).toBe(true);
      expect(quote.total.toString()).toBe("100"); // tax 0 here; shipping excluded
      expect(quote.lines[0]).toMatchObject({ available: true, productSlug: "test-product", lineId: expect.any(String), productId: expect.any(String), image: null, optionLabels: [] });
    });

    it("throws ConflictError for DELIVERY without address", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "FLAT",
        flatShippingFee: ZERO,
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 0 },
      });

      const product = await ProductModel.create({
        name: { en: "Test Product", ar: "منتج تجريبي" },
        slug: "test-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "TEST-001",
        variantKey: `${product._id}|`,
        price: toMoney(100),
        stock: 10,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        fulfilmentDraft: { mode: "DELIVERY" },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      await expect(
        generateQuote({
          actor,
          locale: "en",
          now: new Date("2026-01-15T10:00:00Z"),
        })
      ).rejects.toThrow(ConflictError);
      await expect(
        generateQuote({
          actor,
          locale: "en",
          now: new Date("2026-01-15T10:00:00Z"),
        })
      ).rejects.toThrow("Delivery address required");
    });

    it("throws NotFoundError for PICKUP with invalid pickupLocationId", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: false,
        pickupEnabled: true,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "FLAT",
        flatShippingFee: ZERO,
        orderMinimum: ZERO,
        tax: { mode: "ADDED", rate: 0 },
      });

      const product = await ProductModel.create({
        name: { en: "Test Product", ar: "منتج تجريبي" },
        slug: "test-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "TEST-001",
        variantKey: `${product._id}|`,
        price: toMoney(100),
        stock: 10,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        fulfilmentDraft: {
          mode: "PICKUP",
          pickupLocationId: new mongoose.Types.ObjectId(),
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      await expect(
        generateQuote({
          actor,
          locale: "en",
          now: new Date("2026-01-15T10:00:00Z"),
        })
      ).rejects.toThrow(NotFoundError);
      await expect(
        generateQuote({
          actor,
          locale: "en",
          now: new Date("2026-01-15T10:00:00Z"),
        })
      ).rejects.toThrow("Invalid pickup location");
    });

    it("throws ConflictError when subtotal is below order minimum", async () => {
      await FulfilmentSettingsModel.create({
        deliveryEnabled: true,
        pickupEnabled: false,
        defaultDispatchLeadDays: 1,
        shippingFeeMode: "BY_ZONE",
        flatShippingFee: ZERO,
        orderMinimum: toMoney(50),
        tax: { mode: "ADDED", rate: 0 },
      });

      await DeliveryZoneModel.create({
        name: { en: "Cairo", ar: "القاهرة" },
        active: true,
        fee: toMoney(20),
        leadDays: 2,
        minimumOrder: toMoney(200),
      });

      const product = await ProductModel.create({
        name: { en: "Test Product", ar: "منتج تجريبي" },
        slug: "test-product",
        categoryId: new mongoose.Types.ObjectId(),
        collectionIds: [],
        lifecycle: "published",
      });

      const variant = await VariantModel.create({
        productId: product._id,
        sku: "TEST-001",
        variantKey: `${product._id}|`,
        price: toMoney(100),
        stock: 10,
        backorderPolicy: "DENY",
        discontinued: false,
        optionValues: [],
      });

      const cart = await CartModel.create({
        customerId: new mongoose.Types.ObjectId(),
        fulfilmentDraft: {
          mode: "DELIVERY",
          address: {
            recipientName: "John Doe",
            phone: "+201234567890",
            addressLine1: "123 Test St",
            city: "Cairo",
            governorate: "Cairo",
          },
        },
      });

      await CartLineModel.create({
        cartId: cart._id,
        variantId: variant._id,
        lineIdentityKey: `${cart._id}|${variant._id}|`,
        quantity: 1,
      });

      const actor: ShopActor = { kind: "customer", customer: { _id: cart.customerId!.toString(), name: "Test Customer", phone: "+201234567890" } };

      await expect(
        generateQuote({
          actor,
          locale: "en",
          now: new Date("2026-01-15T10:00:00Z"),
        })
      ).rejects.toThrow(ConflictError);
      await expect(
        generateQuote({
          actor,
          locale: "en",
          now: new Date("2026-01-15T10:00:00Z"),
        })
      ).rejects.toThrow("below the minimum");
    });
  });
});