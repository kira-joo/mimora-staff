// @vitest-environment node
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { ServiceUnavailableError } from "@kira-joo/backend-toolkit-core";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CategoryModel } from "../category.schema";
import { ProductModel } from "../product.schema";
import { VariantModel } from "../variant.schema";
import { connectToDatabase } from "../../core/db/connect";
import { productRepository } from "../../core/repositories";
import { failAfterWrite, restoreInjectedFailures } from "../../core/test-support/rollback-injection";
import { maintainProductListingRollup } from "./maintain-product-listing";
import { rebuildAllProductListings } from "./rebuild-product-listings";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  restoreInjectedFailures();
  await Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({}), VariantModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function seedProduct() {
  const category = await CategoryModel.create({ slug: "electronics" });
  const product = await ProductModel.create({
    slug: `p-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "T", ar: "ت" },
  });
  return product;
}

describe("maintainProductListingRollup", () => {
  it("computes min/max price and purchasable count across active variants", async () => {
    const product = await seedProduct();
    await VariantModel.create([
      { productId: product._id, sku: "A", variantKey: "a", price: toMoney("50.00"), stock: 3 },
      { productId: product._id, sku: "B", variantKey: "b", price: toMoney("30.00"), stock: 0 }, // out of stock, not purchasable
      { productId: product._id, sku: "C", variantKey: "c", price: toMoney("80.00"), stock: 5 },
    ]);

    await withTransaction(async (tx) => {
      await maintainProductListingRollup(product._id);
      return tx.complete(undefined);
    });

    const updated = await ProductModel.findById(product._id).lean();
    // Money fields round-trip as Decimal128 on a lean read; toString() still
    // gives the exact decimal, which is all this assertion needs.
    expect(updated?.listing.minActivePrice?.toString()).toBe("30.00");
    expect(updated?.listing.maxActivePrice?.toString()).toBe("80.00");
    expect(updated?.listing.purchasableVariantCount).toBe(2); // A and C only — B is out of stock
  });

  it("excludes discontinued variants from the active price range entirely", async () => {
    const product = await seedProduct();
    await VariantModel.create([
      { productId: product._id, sku: "A", variantKey: "a", price: toMoney("10.00"), stock: 1 },
      { productId: product._id, sku: "B", variantKey: "b", price: toMoney("999.00"), stock: 1, discontinued: true },
    ]);

    await withTransaction(async (tx) => {
      await maintainProductListingRollup(product._id);
      return tx.complete(undefined);
    });

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.listing.maxActivePrice?.toString()).toBe("10.00"); // the 999.00 discontinued variant never enters the range
    expect(updated?.listing.purchasableVariantCount).toBe(1);
  });

  it("counts a CONTINUE_SELLING variant as purchasable even at zero stock", async () => {
    const product = await seedProduct();
    await VariantModel.create({
      productId: product._id,
      sku: "A",
      variantKey: "a",
      price: toMoney("10.00"),
      stock: 0,
      backorderPolicy: "CONTINUE_SELLING",
    });

    await withTransaction(async (tx) => {
      await maintainProductListingRollup(product._id);
      return tx.complete(undefined);
    });

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.listing.purchasableVariantCount).toBe(1);
  });

  it("recomputes to zero when every variant is deleted (a boolean would not have to be told this; a count is recomputed fresh)", async () => {
    const product = await seedProduct();
    const variant = await VariantModel.create({ productId: product._id, sku: "A", variantKey: "a", price: toMoney("10.00"), stock: 1 });

    await withTransaction(async (tx) => {
      await maintainProductListingRollup(product._id);
      return tx.complete(undefined);
    });
    expect((await ProductModel.findById(product._id).lean())?.listing.purchasableVariantCount).toBe(1);

    await VariantModel.deleteOne({ _id: variant._id });
    await withTransaction(async (tx) => {
      await maintainProductListingRollup(product._id);
      return tx.complete(undefined);
    });

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.listing.purchasableVariantCount).toBe(0);
    expect(updated?.listing.minActivePrice).toBeUndefined();
  });

  it("rolls back with the rest of the transaction on failure — the rollup write is not durable on its own", async () => {
    const product = await seedProduct();
    await VariantModel.create({ productId: product._id, sku: "A", variantKey: "a", price: toMoney("42.00"), stock: 1 });

    await expect(
      withTransaction(async () => {
        await maintainProductListingRollup(product._id);
        throw new Error("simulated failure after the rollup write");
      })
    ).rejects.toThrow("simulated failure");

    const updated = await ProductModel.findById(product._id).lean();
    // The default listing (purchasableVariantCount: 0, no prices) — the rollup write never committed.
    expect(updated?.listing.purchasableVariantCount).toBe(0);
    expect(updated?.listing.minActivePrice).toBeUndefined();
  });

  it("stays correct under concurrent recomputation for the same product (each call is a full, independent aggregate — nothing to interleave incorrectly)", async () => {
    const product = await seedProduct();
    await VariantModel.create([
      { productId: product._id, sku: "A", variantKey: "a", price: toMoney("15.00"), stock: 2 },
      { productId: product._id, sku: "B", variantKey: "b", price: toMoney("25.00"), stock: 2 },
    ]);

    /*
     * Every call rewrites the SAME product document, so five simultaneous
     * transactions are five writers on one hot document. `withTransaction` retries
     * a WriteConflict up to 4 times and then throws a 503 ServiceUnavailableError.
     * Measured (Phase 7): this test failed 1 run in ~15 with exactly that error when
     * it used `Promise.all`. The 503 is the toolkit's documented, retryable
     * contention signal — not wrong data — so this test asserts what the rollup
     * actually promises: any call that does NOT lose the retry race commits a
     * correct aggregate, any call that does fails with that specific retryable
     * error (never something else), and at least one always wins.
     */
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withTransaction(async (tx) => {
          await maintainProductListingRollup(product._id);
          return tx.complete(undefined);
        })
      )
    );
    expect(outcomes.some((o) => o.status === "fulfilled")).toBe(true);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(ServiceUnavailableError);
        expect((outcome.reason as Error).message).toMatch(/repeated write conflicts/);
      }
    }

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.listing.minActivePrice?.toString()).toBe("15.00");
    expect(updated?.listing.maxActivePrice?.toString()).toBe("25.00");
    expect(updated?.listing.purchasableVariantCount).toBe(2);
  });

  it("writes compareAtPrice for the cheapest purchasable variant only when it exceeds its price, and unsets it when it stops", async () => {
    const product = await seedProduct();
    const [cheap] = await VariantModel.create([
      { productId: product._id, sku: "S1", variantKey: "s1", price: toMoney("40.00"), compareAtPrice: toMoney("60.00"), stock: 2 },
      { productId: product._id, sku: "S2", variantKey: "s2", price: toMoney("90.00"), compareAtPrice: toMoney("200.00"), stock: 2 },
    ]);
    const run = () => withTransaction(async (tx) => { await maintainProductListingRollup(product._id); return tx.complete(undefined); });

    await run();
    expect((await ProductModel.findById(product._id).lean())?.listing.compareAtPrice?.toString()).toBe("60.00");

    await VariantModel.updateOne({ _id: cheap!._id }, { $set: { compareAtPrice: toMoney("40.00") } }); // equal to price: no sale
    await run();
    expect((await ProductModel.findById(product._id).lean())?.listing.compareAtPrice).toBeUndefined();
  });
});

describe("maintainProductListingRollup — option and low-stock facts", () => {
  const run = (productId: mongoose.Types.ObjectId) =>
    withTransaction(async (tx) => {
      await maintainProductListingRollup(productId);
      return tx.complete(undefined);
    });
  const variant = (productId: mongoose.Types.ObjectId, sku: string, size: string, colour: string, extra: Record<string, unknown> = {}) => ({
    productId,
    sku,
    variantKey: sku.toLowerCase(),
    price: toMoney("10.00"),
    stock: 5,
    optionValues: [{ key: "size", value: size }, { key: "colour", value: colour }],
    ...extra,
  });

  it("stores the option pairs of purchasable variants only — a value present only on a sold-out variant is not available", async () => {
    const product = await seedProduct();
    await VariantModel.create([
      variant(product._id, "S-RED", "s", "red"),
      variant(product._id, "M-BLUE", "m", "blue", { stock: 0 }), // sold out: m and blue exist nowhere else
      variant(product._id, "L-RED", "l", "red", { discontinued: true }), // discontinued: l exists nowhere else
    ]);

    await run(product._id);

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.listing.availableOptions).toEqual(["colour:red", "size:s"]);
  });

  it("recomputes when stock returns, and writes an empty set (not a stale one) when nothing is purchasable", async () => {
    const product = await seedProduct();
    const only = await VariantModel.create(variant(product._id, "M-BLUE", "m", "blue", { stock: 0 }));

    await run(product._id);
    expect((await ProductModel.findById(product._id).lean())?.listing.availableOptions).toEqual([]);

    await VariantModel.updateOne({ _id: only._id }, { $set: { stock: 3 } });
    await run(product._id);
    expect((await ProductModel.findById(product._id).lean())?.listing.availableOptions).toEqual(["colour:blue", "size:m"]);

    await VariantModel.updateOne({ _id: only._id }, { $set: { stock: 0 } });
    await run(product._id);
    expect((await ProductModel.findById(product._id).lean())?.listing.availableOptions).toEqual([]);
  });

  it("stores the smallest tracked stock, and unsets it when no tracked variant is purchasable", async () => {
    const product = await seedProduct();
    const a = await VariantModel.create(variant(product._id, "A", "s", "red", { stock: 9 }));
    const b = await VariantModel.create(variant(product._id, "B", "m", "red", { stock: 2 }));

    await run(product._id);
    let listing = (await ProductModel.findById(product._id).lean())?.listing;
    expect(listing?.minTrackedStock).toBe(2);
    expect(listing?.lowStockOverride).toBe(false);

    await VariantModel.updateMany({ _id: { $in: [a._id, b._id] } }, { $set: { stock: 0 } });
    await run(product._id);
    listing = (await ProductModel.findById(product._id).lean())?.listing;
    expect(listing?.minTrackedStock).toBeUndefined();
  });

  it("flags a variant at its own low-stock threshold, and never a CONTINUE_SELLING one", async () => {
    const product = await seedProduct();
    await VariantModel.create([variant(product._id, "A", "s", "red", { stock: 4, lowStockThreshold: 10 }), variant(product._id, "B", "m", "red", { stock: 1, backorderPolicy: "CONTINUE_SELLING" })]);

    await run(product._id);

    const listing = (await ProductModel.findById(product._id).lean())?.listing;
    expect(listing?.lowStockOverride).toBe(true);
    expect(listing?.minTrackedStock).toBeUndefined();
  });

  it("rebuildAllProductListings backfills a product written before the rollup had these fields", async () => {
    const product = await seedProduct();
    await VariantModel.create([variant(product._id, "A", "s", "red")]);
    expect((await ProductModel.findById(product._id).lean())?.listing.availableOptions).toBeUndefined();

    expect(await rebuildAllProductListings()).toEqual({ processed: 1, batches: 1 });

    expect((await ProductModel.findById(product._id).lean())?.listing.availableOptions).toEqual(["colour:red", "size:s"]);
  });
});

describe("rebuildAllProductListings rollback — one transaction per product", () => {
  it("a failure after a product's rollup write reverts THAT product only; the products already rebuilt stay rebuilt", async () => {
    const category = await CategoryModel.create({ slug: "rebuild-rollback" });
    const make = async (slug: string) => {
      const product = await ProductModel.create({ slug, categoryId: category._id, lifecycle: "published", name: { en: slug, ar: "ت" } });
      await VariantModel.create([{ productId: product._id, sku: `${slug}-A`, variantKey: `${slug}-a`, price: toMoney("50.00"), stock: 3 }]);
      return product;
    };
    const first = await make("rb-first"); // the rebuild visits products in `_id` order
    const second = await make("rb-second");
    const secondBefore = await ProductModel.collection.findOne({ _id: second._id });
    expect(secondBefore?.listing?.availableOptions).toBeUndefined(); // stale: written before the rollup existed
    // Each product's rollup is exactly one productRepository.updateAtomic; the 2nd call is the second product's write.
    failAfterWrite(productRepository, "updateAtomic", 2);

    await expect(rebuildAllProductListings()).rejects.toThrow("injected failure");

    expect((await ProductModel.findById(first._id).lean())?.listing.purchasableVariantCount).toBe(1); // committed on its own
    expect(await ProductModel.collection.findOne({ _id: second._id })).toEqual(secondBefore); // its real write was rolled back
  });
});
