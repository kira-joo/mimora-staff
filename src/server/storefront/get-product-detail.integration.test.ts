// @vitest-environment node
import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CategoryModel } from "../catalog/category.schema";
import { ProductModel } from "../catalog/product.schema";
import { VariantModel } from "../catalog/variant.schema";
import { InventorySettingsModel } from "../fulfilment/inventory-settings.schema";
import { connectToDatabase } from "../core/db/connect";
import { getProductDetail } from "./get-product-detail";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({}), VariantModel.deleteMany({}), InventorySettingsModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function seedCategory() {
  return CategoryModel.create({ slug: "electronics" });
}

describe("getProductDetail", () => {
  it("throws NotFoundError for a slug that does not exist", async () => {
    await expect(getProductDetail("nonexistent")).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError for a draft product — same as one that does not exist", async () => {
    const category = await seedCategory();
    await ProductModel.create({ slug: "draft-product", categoryId: category._id, lifecycle: "draft", name: { en: "T", ar: "ت" } });

    await expect(getProductDetail("draft-product")).rejects.toThrow(NotFoundError);
  });

  it("returns the product with localized content and the purchasable variant matrix", async () => {
    const category = await seedCategory();
    const product = await ProductModel.create({
      slug: "t-shirt",
      categoryId: category._id,
      lifecycle: "published",
      name: { en: "T-Shirt", ar: "تيشيرت" },
      optionAxes: [{ key: "size", name: { en: "Size", ar: "المقاس" } }],
    });
    await VariantModel.create([
      { productId: product._id, sku: "TS-S", variantKey: "s", optionValues: [{ key: "size", value: "S" }], price: toMoney("50.00"), stock: 5 },
      { productId: product._id, sku: "TS-M", variantKey: "m", optionValues: [{ key: "size", value: "M" }], price: toMoney("55.00"), stock: 0 },
    ]);

    const detail = await getProductDetail("t-shirt");
    expect(detail.product.name.ar).toBe("تيشيرت");
    expect(detail.variants).toHaveLength(2);

    const small = detail.variants.find((v) => v.optionValues.some((o) => o.value === "S"));
    const medium = detail.variants.find((v) => v.optionValues.some((o) => o.value === "M"));
    expect(small?.purchasable).toBe(true); // in stock
    expect(medium?.purchasable).toBe(false); // out of stock, DENY policy

    // Never admin inventory detail — no `stock` field reaches this view at all.
    expect(small).not.toHaveProperty("stock");
  });

  it("marks a discontinued variant unpurchasable even with stock remaining", async () => {
    const category = await seedCategory();
    const product = await ProductModel.create({ slug: "shoe", categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });
    await VariantModel.create({ productId: product._id, sku: "SH-1", variantKey: "k", price: toMoney("10.00"), stock: 10, discontinued: true });

    const detail = await getProductDetail("shoe");
    expect(detail.variants[0]?.purchasable).toBe(false);
  });

  it("a CONTINUE_SELLING variant at zero stock is still purchasable", async () => {
    const category = await seedCategory();
    const product = await ProductModel.create({ slug: "preorder", categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });
    await VariantModel.create({ productId: product._id, sku: "PO-1", variantKey: "k", price: toMoney("10.00"), stock: 0, backorderPolicy: "CONTINUE_SELLING" });

    const detail = await getProductDetail("preorder");
    expect(detail.variants[0]?.purchasable).toBe(true);
  });

  it("a product with no variants returns an empty matrix, not an error", async () => {
    const category = await seedCategory();
    await ProductModel.create({ slug: "no-variants", categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });

    const detail = await getProductDetail("no-variants");
    expect(detail.variants).toEqual([]);
  });

  it("carries lowStock from the store threshold, honours a per-variant override, and never exposes the quantity", async () => {
    await InventorySettingsModel.create({ lowStockThreshold: 3 });
    const category = await seedCategory();
    const product = await ProductModel.create({ slug: "mug", categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });
    await VariantModel.create([
      { productId: product._id, sku: "M-1", variantKey: "a", optionValues: [{ key: "size", value: "a" }], price: toMoney("10.00"), stock: 3 },
      { productId: product._id, sku: "M-2", variantKey: "b", optionValues: [{ key: "size", value: "b" }], price: toMoney("10.00"), stock: 4 },
      { productId: product._id, sku: "M-3", variantKey: "c", optionValues: [{ key: "size", value: "c" }], price: toMoney("10.00"), stock: 4, lowStockThreshold: 6 },
      { productId: product._id, sku: "M-4", variantKey: "d", optionValues: [{ key: "size", value: "d" }], price: toMoney("10.00"), stock: 1, backorderPolicy: "CONTINUE_SELLING" },
    ]);

    const { variants } = await getProductDetail("mug");
    const lowBy = (value: string) => variants.find((v) => v.optionValues[0]?.value === value)?.lowStock;
    expect(lowBy("a")).toBe(true);
    expect(lowBy("b")).toBe(false);
    expect(lowBy("c")).toBe(true);
    expect(lowBy("d")).toBe(false);
    expect(variants[0]).not.toHaveProperty("stock");
  });
  describe("display facts for backorder, unit of measure and the per-variant gallery", () => {
    const image = (id: string) => ({ provider: "cloudinary", publicId: id, secureUrl: `https://cdn.test/${id}.jpg`, format: "jpg", width: 800, height: 1000, bytes: 1000 });

    it("projects sku, backorder policy, unit of measure and units per sale", async () => {
      const category = await seedCategory();
      const product = await ProductModel.create({ slug: "bolts", categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });
      await VariantModel.create({ productId: product._id, sku: "BOLT-PACK-10", variantKey: "k", price: toMoney("10.00"), stock: 8, unitOfMeasure: "PACK", unitsPerSale: 10 });

      const [variant] = (await getProductDetail("bolts")).variants;
      expect(variant).toMatchObject({ sku: "BOLT-PACK-10", backorderPolicy: "DENY", onBackorder: false, unitOfMeasure: "PACK", unitsPerSale: 10 });
    });

    it("flags onBackorder only for CONTINUE_SELLING with nothing on hand — never for stocked or DENY variants", async () => {
      const category = await seedCategory();
      const product = await ProductModel.create({ slug: "made-to-order", categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });
      await VariantModel.create([
        { productId: product._id, sku: "A", variantKey: "a", optionValues: [{ key: "size", value: "a" }], price: toMoney("10.00"), stock: 0, backorderPolicy: "CONTINUE_SELLING" },
        { productId: product._id, sku: "B", variantKey: "b", optionValues: [{ key: "size", value: "b" }], price: toMoney("10.00"), stock: 4, backorderPolicy: "CONTINUE_SELLING" },
        { productId: product._id, sku: "C", variantKey: "c", optionValues: [{ key: "size", value: "c" }], price: toMoney("10.00"), stock: 0, backorderPolicy: "DENY" },
        { productId: product._id, sku: "D", variantKey: "d", optionValues: [{ key: "size", value: "d" }], price: toMoney("10.00"), stock: 0, backorderPolicy: "CONTINUE_SELLING", discontinued: true },
      ]);

      const { variants } = await getProductDetail("made-to-order");
      const by = (sku: string) => variants.find((variant) => variant.sku === sku);
      expect(by("A")).toMatchObject({ purchasable: true, onBackorder: true, backorderPolicy: "CONTINUE_SELLING" });
      expect(by("B")).toMatchObject({ purchasable: true, onBackorder: false });
      expect(by("C")).toMatchObject({ purchasable: false, onBackorder: false });
      // A discontinued variant is not orderable, so it cannot be "available to order" either.
      expect(by("D")).toMatchObject({ purchasable: false, onBackorder: false });
      for (const variant of variants) expect(variant).not.toHaveProperty("stock");
    });

    it("projects a variant's galleryOverride, and an empty list when it has none", async () => {
      const category = await seedCategory();
      const product = await ProductModel.create({ slug: "tee", categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });
      await VariantModel.create([
        { productId: product._id, sku: "RED", variantKey: "r", optionValues: [{ key: "colour", value: "red" }], price: toMoney("10.00"), stock: 1, galleryOverride: [image("red-1"), image("red-2")] },
        { productId: product._id, sku: "BLUE", variantKey: "b", optionValues: [{ key: "colour", value: "blue" }], price: toMoney("10.00"), stock: 1 },
      ]);

      const { variants } = await getProductDetail("tee");
      expect(variants.find((variant) => variant.sku === "RED")?.galleryOverride.map((asset) => asset.publicId)).toEqual(["red-1", "red-2"]);
      expect(variants.find((variant) => variant.sku === "BLUE")?.galleryOverride).toEqual([]);
    });
  });
});
