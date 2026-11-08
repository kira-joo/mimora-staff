import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { productRepository } from "../../core/repositories";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { StockMovementModel } from "../../catalog/stock-movement.schema";
import { InventorySettingsModel } from "../../fulfilment/inventory-settings.schema";
import { listInventory } from "./list-inventory";
import { adjustStock } from "./adjust-stock";
import { bulkAdjustStock } from "./bulk-adjust-stock";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";

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

async function seedProductAndVariant(options: { stock?: number; lowStockThreshold?: number; categoryId?: mongoose.Types.ObjectId } = {}) {
  const category = options.categoryId
    ? undefined
    : await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId().toString()}` });
  const categoryId = options.categoryId ?? category!._id;

  const product = await ProductModel.create({
    slug: `product-${new mongoose.Types.ObjectId().toString()}`,
    categoryId,
    lifecycle: "published",
    name: { en: "Test", ar: "تجربة" },
  });
  const variant = await VariantModel.create({
    productId: product._id,
    sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
    variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    price: toMoney("10.00"),
    stock: options.stock ?? 10,
    lowStockThreshold: options.lowStockThreshold,
  });
  return { category, categoryId, product, variant };
}

describe("Admin Inventory", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([
      VariantModel.deleteMany({}),
      ProductModel.deleteMany({}),
      CategoryModel.deleteMany({}),
      StockMovementModel.deleteMany({}),
      InventorySettingsModel.deleteMany({}),
    ]);
  });

  describe("listInventory", () => {
    it("filters by productId and categoryId", async () => {
      const a = await seedProductAndVariant();
      const b = await seedProductAndVariant();

      const byProduct = await listInventory({ limit: 10, page: 1, productId: a.product._id.toString() });
      expect(byProduct.total).toBe(1);
      expect(byProduct.data[0]?.sku).toBe(a.variant.sku);

      const byCategory = await listInventory({ limit: 10, page: 1, categoryId: b.categoryId.toString() });
      expect(byCategory.total).toBe(1);
      expect(byCategory.data[0]?.sku).toBe(b.variant.sku);
    });

    it("filters outOfStock (stock 0, DENY policy)", async () => {
      await seedProductAndVariant({ stock: 0 });
      await seedProductAndVariant({ stock: 5 });

      const result = await listInventory({ limit: 10, page: 1, outOfStock: true });
      expect(result.total).toBe(1);
    });

    it("filters lowStock against the per-variant threshold or the settings default", async () => {
      await InventorySettingsModel.create({ lowStockThreshold: 3 });
      await seedProductAndVariant({ stock: 2 }); // below the global default of 3
      await seedProductAndVariant({ stock: 8, lowStockThreshold: 10 }); // below its own threshold
      await seedProductAndVariant({ stock: 20 }); // well above default

      const result = await listInventory({ limit: 10, page: 1, lowStock: true });
      expect(result.total).toBe(2);
    });
  });

  describe("adjustStock", () => {
    it("increases stock and records a RECEIPT movement", async () => {
      const { variant } = await seedProductAndVariant({ stock: 10 });
      const staffId = new mongoose.Types.ObjectId().toString();

      const updated = await adjustStock({ variantId: variant._id.toString(), delta: 5, reason: "RECEIPT", staffId, now: new Date() });
      expect(updated.stock).toBe(15);

      const movement = await StockMovementModel.findOne({ variantId: variant._id }).lean();
      expect(movement?.delta).toBe(5);
      expect(movement?.reason).toBe("RECEIPT");
      expect(movement?.actorId?.toString()).toBe(staffId);
    });

    it("decreases stock and records a DAMAGE movement", async () => {
      const { variant } = await seedProductAndVariant({ stock: 10 });
      const updated = await adjustStock({
        variantId: variant._id.toString(),
        delta: -3,
        reason: "DAMAGE",
        note: "Water damage",
        staffId: new mongoose.Types.ObjectId().toString(),
        now: new Date(),
      });
      expect(updated.stock).toBe(7);
    });

    it("throws ConflictError when the adjustment would take stock below zero", async () => {
      const { variant } = await seedProductAndVariant({ stock: 2 });
      await expect(
        adjustStock({ variantId: variant._id.toString(), delta: -5, reason: "ADJUSTMENT", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent variant", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(
        adjustStock({ variantId: fakeId, delta: 1, reason: "ADJUSTMENT", staffId: fakeId, now: new Date() })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("bulkAdjustStock", () => {
    it("applies every item and recomputes affected products' rollups", async () => {
      const a = await seedProductAndVariant({ stock: 10 });
      const b = await seedProductAndVariant({ stock: 20 });
      const staffId = new mongoose.Types.ObjectId().toString();

      const updated = await bulkAdjustStock({
        items: [
          { variantId: a.variant._id.toString(), delta: 5, reason: "RECEIPT" },
          { variantId: b.variant._id.toString(), delta: -5, reason: "ADJUSTMENT" },
        ],
        staffId,
        now: new Date(),
      });

      const byId = new Map(updated.map((v) => [v._id.toString(), v]));
      expect(byId.get(a.variant._id.toString())?.stock).toBe(15);
      expect(byId.get(b.variant._id.toString())?.stock).toBe(15);
    });

    it("throws NotFoundError when any item references a non-existent variant, applying nothing", async () => {
      const { variant } = await seedProductAndVariant({ stock: 10 });
      const fakeId = new mongoose.Types.ObjectId().toString();

      await expect(
        bulkAdjustStock({
          items: [
            { variantId: variant._id.toString(), delta: 5, reason: "RECEIPT" },
            { variantId: fakeId, delta: 5, reason: "RECEIPT" },
          ],
          staffId: fakeId,
          now: new Date(),
        })
      ).rejects.toThrow(NotFoundError);

      const untouched = await VariantModel.findById(variant._id).lean();
      expect(untouched?.stock).toBe(10);
    });
  });

  describe("rollback: a failure inside the transaction leaves no partial state", () => {
    it("adjustStock: stock, stock movement and product rollup all revert when the rollup write fails", async () => {
      const { product, variant } = await seedProductAndVariant({ stock: 10 });
      const listingBefore = (await ProductModel.findById(product._id).lean())?.listing;
      failAfterWrite(productRepository, "updateAtomic", 1); // the rollup write, last in the transaction

      await expect(
        adjustStock({ variantId: variant._id.toString(), delta: 5, reason: "RECEIPT", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow("injected failure");

      expect((await VariantModel.findById(variant._id).lean())?.stock).toBe(10);
      expect(await StockMovementModel.countDocuments({})).toBe(0);
      expect((await ProductModel.findById(product._id).lean())?.listing).toEqual(listingBefore);
    });

    it("bulkAdjustStock: every item's stock, every movement and both rollups revert when the LAST rollup fails", async () => {
      const a = await seedProductAndVariant({ stock: 10 });
      const b = await seedProductAndVariant({ stock: 20 });
      const listingA = (await ProductModel.findById(a.product._id).lean())?.listing;
      const listingB = (await ProductModel.findById(b.product._id).lean())?.listing;
      failAfterWrite(productRepository, "updateAtomic", 2); // 2 rollups (one per product); the second is the last write

      await expect(
        bulkAdjustStock({
          items: [
            { variantId: a.variant._id.toString(), delta: 3, reason: "RECEIPT" },
            { variantId: b.variant._id.toString(), delta: -4, reason: "DAMAGE" },
          ],
          staffId: new mongoose.Types.ObjectId().toString(),
          now: new Date(),
        })
      ).rejects.toThrow("injected failure");

      expect((await VariantModel.findById(a.variant._id).lean())?.stock).toBe(10);
      expect((await VariantModel.findById(b.variant._id).lean())?.stock).toBe(20);
      expect(await StockMovementModel.countDocuments({})).toBe(0);
      expect((await ProductModel.findById(a.product._id).lean())?.listing).toEqual(listingA);
      expect((await ProductModel.findById(b.product._id).lean())?.listing).toEqual(listingB);
    });
  });
});
