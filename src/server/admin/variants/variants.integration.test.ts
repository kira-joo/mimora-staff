import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { sanitizeLeanResult } from "@kira-joo/backend-toolkit-mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { CategoryModel } from "../../catalog/category.schema";
import { createVariant } from "./create-variant";
import { updateVariant } from "./update-variant";
import { deleteVariant } from "./delete-variant";
import { listVariants } from "./list-variants";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { productRepository } from "../../core/repositories";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const injectedSpies: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  while (injectedSpies.length > 0) injectedSpies.pop()!.mockRestore();
});

/**
 * Rollback-test injection. Lets the real write land, THEN fails the `nth` call
 * to `repo[method]` — so the rollback has a write that genuinely happened to
 * undo. Failing before the write would prove nothing about atomicity.
 */
function failAfterWrite(repo: object, method: string, nth = 1): void {
  const target = repo as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method]!.bind(repo);
  let calls = 0;
  const spy = vi.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
    const result = await original(...args);
    calls += 1;
    if (calls === nth) throw new Error("injected failure");
    return result;
  });
  injectedSpies.push(spy);
}

describe("Admin Variants", () => {
  let productId: string;

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await VariantModel.deleteMany({});
    await ProductModel.deleteMany({});
    await CategoryModel.deleteMany({});

    const category = await CategoryModel.create({
      name: { ar: "فئة", en: "Category" },
      slug: "test-category",
      published: true,
      sortOrder: 0,
    });

    const product = await ProductModel.create({
      name: { ar: "منتج", en: "Product" },
      description: { ar: "وصف", en: "Description" },
      slug: "test-product",
      categoryId: category._id,
      optionAxes: [
        { key: "colour", name: { ar: "لون", en: "Colour" } },
        { key: "size", name: { ar: "مقاس", en: "Size" } },
      ],
      lifecycle: "published",
    });
    productId = product._id.toString();
  });

  describe("createVariant", () => {
    it("creates a variant and recomputes the product's listing rollup", async () => {
      const variant = await createVariant({
        productId,
        sku: "SKU-RED-M",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("100.00"),
        stock: 10,
      });

      expect(variant.sku).toBe("SKU-RED-M");
      expect(variant.variantKey).toBe(`${productId}|colour=red|size=m`);
      expect(variant.price.toFixed(2)).toBe("100.00");
      expect(variant.discontinued).toBe(false);
      expect(variant.backorderPolicy).toBe("DENY");

      const product = sanitizeLeanResult(await ProductModel.findById(productId).lean());
      expect(product?.listing.purchasableVariantCount).toBe(1);
      expect(product?.listing.minActivePrice?.toFixed(2)).toBe("100.00");
      expect(product?.listing.maxActivePrice?.toFixed(2)).toBe("100.00");
    });

    it("canonically orders variantKey regardless of submitted optionValues order", async () => {
      const variant = await createVariant({
        productId,
        sku: "SKU-BLUE-L",
        optionValues: [
          { key: "size", value: "l" },
          { key: "colour", value: "blue" },
        ],
        price: toMoney("50.00"),
        stock: 5,
      });

      expect(variant.variantKey).toBe(`${productId}|colour=blue|size=l`);
    });

    it("throws NotFoundError for a non-existent product", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(
        createVariant({
          productId: fakeId,
          sku: "SKU-X",
          optionValues: [
            { key: "colour", value: "red" },
            { key: "size", value: "m" },
          ],
          price: toMoney("10.00"),
          stock: 1,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("throws ConflictError when option values don't match the product's option axes", async () => {
      await expect(
        createVariant({
          productId,
          sku: "SKU-BAD",
          optionValues: [{ key: "colour", value: "red" }],
          price: toMoney("10.00"),
          stock: 1,
        })
      ).rejects.toThrow(ConflictError);
    });

    it("throws ConflictError on duplicate SKU", async () => {
      await createVariant({
        productId,
        sku: "SKU-DUP",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      await expect(
        createVariant({
          productId,
          sku: "SKU-DUP",
          optionValues: [
            { key: "colour", value: "blue" },
            { key: "size", value: "l" },
          ],
          price: toMoney("10.00"),
          stock: 1,
        })
      ).rejects.toThrow(ConflictError);
    });

    it("throws ConflictError on duplicate option combination", async () => {
      await createVariant({
        productId,
        sku: "SKU-A",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      await expect(
        createVariant({
          productId,
          sku: "SKU-B",
          optionValues: [
            { key: "colour", value: "red" },
            { key: "size", value: "m" },
          ],
          price: toMoney("20.00"),
          stock: 1,
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("updateVariant", () => {
    it("updates non-rollup fields without touching the product listing", async () => {
      const created = await createVariant({
        productId,
        sku: "SKU-UPD",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      const updated = await updateVariant(created._id.toString(), { unitOfMeasure: "PACK" });
      expect(updated.unitOfMeasure).toBe("PACK");
    });

    it("updates price and recomputes the product listing rollup", async () => {
      const created = await createVariant({
        productId,
        sku: "SKU-PRICE",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      await updateVariant(created._id.toString(), { price: toMoney("75.00") });

      const product = sanitizeLeanResult(await ProductModel.findById(productId).lean());
      expect(product?.listing.minActivePrice?.toFixed(2)).toBe("75.00");
      expect(product?.listing.maxActivePrice?.toFixed(2)).toBe("75.00");
    });

    it("recomputes purchasableVariantCount when discontinued toggles", async () => {
      const created = await createVariant({
        productId,
        sku: "SKU-DISC",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      await updateVariant(created._id.toString(), { discontinued: true });

      const product = await ProductModel.findById(productId).lean();
      expect(product?.listing.purchasableVariantCount).toBe(0);
      expect(product?.listing.minActivePrice).toBeUndefined();
    });

    it("clears the rollup's optional fields once the last active variant is discontinued", async () => {
      const created = await createVariant({
        productId,
        sku: "SKU-LAST",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      await updateVariant(created._id.toString(), { discontinued: true });

      const raw = await ProductModel.findById(productId).lean();
      expect(Object.prototype.hasOwnProperty.call(raw?.listing ?? {}, "minActivePrice")).toBe(false);
    });

    it("throws ConflictError when updating to a duplicate SKU", async () => {
      await createVariant({
        productId,
        sku: "SKU-ONE",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      const other = await createVariant({
        productId,
        sku: "SKU-TWO",
        optionValues: [
          { key: "colour", value: "blue" },
          { key: "size", value: "l" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      await expect(updateVariant(other._id.toString(), { sku: "SKU-ONE" })).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent variant", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(updateVariant(fakeId, { price: toMoney("5.00") })).rejects.toThrow(NotFoundError);
    });
  });

  describe("deleteVariant", () => {
    it("hard-deletes a variant and recomputes the product listing rollup", async () => {
      const created = await createVariant({
        productId,
        sku: "SKU-DEL",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      await deleteVariant(created._id.toString());

      const found = await VariantModel.findById(created._id).lean();
      expect(found).toBeNull();

      const product = await ProductModel.findById(productId).lean();
      expect(product?.listing.purchasableVariantCount).toBe(0);
    });

    it("throws NotFoundError for a non-existent variant", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(deleteVariant(fakeId)).rejects.toThrow(NotFoundError);
    });
  });

  describe("rollback — a failure inside the transaction leaves no partial state", () => {
    const OPTIONS = [
      { key: "colour", value: "red" },
      { key: "size", value: "m" },
    ];

    it("createVariant: the variant insert is undone when the product rollup write fails", async () => {
      const productBefore = await ProductModel.findById(productId).lean();
      failAfterWrite(productRepository, "updateAtomic", 1); // the rollup write, last in the transaction

      await expect(
        createVariant({ productId, sku: "SKU-ROLL", optionValues: OPTIONS, price: toMoney("10.00"), stock: 3 })
      ).rejects.toThrow("injected failure");

      expect(await VariantModel.countDocuments({})).toBe(0);
      expect((await ProductModel.findById(productId).lean())?.listing).toEqual(productBefore?.listing);
    });

    it("updateVariant: the variant edit is undone when the product rollup write fails", async () => {
      const created = await createVariant({ productId, sku: "SKU-UPD", optionValues: OPTIONS, price: toMoney("10.00"), stock: 3 });
      const productBefore = await ProductModel.findById(productId).lean();
      failAfterWrite(productRepository, "updateAtomic", 1);

      await expect(updateVariant(created._id.toString(), { price: toMoney("99.00") })).rejects.toThrow("injected failure");

      const variantAfter = sanitizeLeanResult(await VariantModel.findById(created._id).lean());
      expect(variantAfter?.price.toFixed(2)).toBe("10.00");
      expect(variantAfter?.stock).toBe(3);
      expect((await ProductModel.findById(productId).lean())?.listing).toEqual(productBefore?.listing);
    });

    it("deleteVariant: the delete is undone when the product rollup write fails", async () => {
      const created = await createVariant({ productId, sku: "SKU-DEL-ROLL", optionValues: OPTIONS, price: toMoney("10.00"), stock: 3 });
      const productBefore = await ProductModel.findById(productId).lean();
      failAfterWrite(productRepository, "updateAtomic", 1);

      await expect(deleteVariant(created._id.toString())).rejects.toThrow("injected failure");

      expect(await VariantModel.findById(created._id).lean()).not.toBeNull();
      expect((await ProductModel.findById(productId).lean())?.listing).toEqual(productBefore?.listing);
    });
  });

  describe("listVariants", () => {
    it("filters by productId and discontinued", async () => {
      const v1 = await createVariant({
        productId,
        sku: "SKU-L1",
        optionValues: [
          { key: "colour", value: "red" },
          { key: "size", value: "m" },
        ],
        price: toMoney("10.00"),
        stock: 1,
      });

      await createVariant({
        productId,
        sku: "SKU-L2",
        optionValues: [
          { key: "colour", value: "blue" },
          { key: "size", value: "l" },
        ],
        price: toMoney("20.00"),
        stock: 1,
      });

      await updateVariant(v1._id.toString(), { discontinued: true });

      const active = await listVariants({ limit: 10, page: 1, productId, discontinued: false });
      expect(active.total).toBe(1);
      expect(active.data[0]?.sku).toBe("SKU-L2");

      const all = await listVariants({ limit: 10, page: 1, productId });
      expect(all.total).toBe(2);
    });
  });
});
