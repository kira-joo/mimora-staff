// @vitest-environment node
import { sanitizeLeanResult } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { CategoryModel } from "./category.schema";
import { ProductModel } from "./product.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

/**
 * `Product.listing.{minActivePrice,maxActivePrice}` are hand-written
 * `moneyField()` entries inside a hand-rolled `mongoose.Schema` (not a
 * `@MongoField()`-decorated class property) — exactly the shape this
 * repo's own `CLAUDE.md` says only a document round-trip test can verify,
 * since nothing checks a hand-written field against its TS interface.
 */
describe("Product.listing — money round-trip", () => {
  it("rounds and persists as Decimal128, and sanitizeLeanResult revives a real Decimal on read", async () => {
    const category = await CategoryModel.create({ slug: "electronics" });
    const product = await ProductModel.create({
      slug: "test-product",
      categoryId: category._id,
      name: { en: "T", ar: "ت" },
      listing: { minActivePrice: toMoney("19.999"), maxActivePrice: toMoney("49.995"), purchasableVariantCount: 2 },
    });

    // Hydrated document — the schema's own getter runs.
    expect(product.listing.minActivePrice?.toFixed(2)).toBe("20.00"); // rounded half-up at MONEY_SCALE
    expect(product.listing.maxActivePrice?.toFixed(2)).toBe("50.00");

    // A raw driver read proves it is Decimal128 at rest, not a float or a string.
    const raw = await mongoose.connection.collection("products").findOne({ _id: product._id });
    expect(raw?.listing.minActivePrice?._bsontype).toBe("Decimal128");

    // A lean read needs sanitizeLeanResult to revive Money — the getter never runs on .lean().
    const lean = sanitizeLeanResult(await ProductModel.findById(product._id).lean());
    expect(lean?.listing.minActivePrice?.toFixed(2)).toBe("20.00");
    expect(typeof lean?.listing.minActivePrice?.mul).toBe("function"); // a real Decimal, not Decimal128
  });

  it("an update via a plain object $set with a dotted path still runs the setter — the exact shape maintain-product-listing.ts uses", async () => {
    const category = await CategoryModel.create({ slug: "electronics" });
    const product = await ProductModel.create({ slug: "p2", categoryId: category._id, name: { en: "T", ar: "ت" } });

    await ProductModel.updateOne({ _id: product._id }, { $set: { "listing.minActivePrice": toMoney("12.345") } });

    const raw = await mongoose.connection.collection("products").findOne({ _id: product._id });
    expect(raw?.listing.minActivePrice?._bsontype).toBe("Decimal128");
    expect(raw?.listing.minActivePrice?.toString()).toBe("12.35"); // rounded, not stored raw
  });
});
