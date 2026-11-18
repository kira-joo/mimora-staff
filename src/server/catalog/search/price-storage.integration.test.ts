// @vitest-environment node
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CategoryModel } from "../category.schema";
import { ProductModel } from "../product.schema";
import { connectToDatabase } from "../../core/db/connect";
import { mongoCatalogSearchPort } from "./mongo-catalog-search-port";

/**
 * Price filters, price sort and the price facet over BSON Double listing prices, over records still holding
 * Decimal128 from before the storage change, and over a mix of both.
 *
 * The boundary is the case that matters: a double 19.99 is really 19.98999…, so MongoDB — which compares mixed
 * numeric types by exact value — would drop it from `>= 19.99` if the bound were a Decimal128, and a Decimal128
 * record from `<= 19.99` if the bound were a double. A shopper filtering "from 19.99" must see the 19.99 product.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});
const clean = () => Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({})]);
beforeEach(clean);
afterEach(clean);
afterAll(async () => {
  await mongoose.disconnect();
});

async function seedProduct(min: string | undefined, max: string | undefined, storage: "double" | "decimal128" = "double") {
  const category = await CategoryModel.create({ slug: `c-${new mongoose.Types.ObjectId().toString()}` });
  const product = await ProductModel.create({
    slug: `p-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "T", ar: "ت" },
    listing: { minActivePrice: min ? toMoney(min) : undefined, maxActivePrice: max ? toMoney(max) : undefined, purchasableVariantCount: 1 },
  });
  if (storage === "decimal128" && min && max) {
    // Exactly what a record written before the change holds.
    await ProductModel.collection.updateOne({ _id: product._id }, { $set: { "listing.minActivePrice": mongoose.Types.Decimal128.fromString(toMoney(min).toFixed(2)), "listing.maxActivePrice": mongoose.Types.Decimal128.fromString(toMoney(max).toFixed(2)) } });
  }
  return product;
}

async function storedType(id: mongoose.Types.ObjectId) {
  const [row] = await ProductModel.collection.aggregate([{ $match: { _id: id } }, { $project: { type: { $type: "$listing.minActivePrice" } } }]).toArray();
  return row?.type;
}

const ids = (result: { data: Array<{ _id: mongoose.Types.ObjectId }> }) => result.data.map((product) => product._id.toString()).sort();

describe.each(["double", "decimal128"] as const)("price filter boundaries — %s storage", (storage) => {
  it("stores what it claims to", async () => {
    const product = await seedProduct("19.99", "19.99", storage);
    expect(await storedType(product._id)).toBe(storage === "double" ? "double" : "decimal");
  });

  it("a product priced exactly at the minimum is included (19.99 >= 19.99)", async () => {
    const product = await seedProduct("19.99", "19.99", storage);
    expect(ids(await mongoCatalogSearchPort.search({ minPrice: "19.99" }))).toEqual([product._id.toString()]);
  });

  it("a product priced exactly at the maximum is included (19.99 <= 19.99)", async () => {
    const product = await seedProduct("19.99", "19.99", storage);
    expect(ids(await mongoCatalogSearchPort.search({ maxPrice: "19.99" }))).toEqual([product._id.toString()]);
  });

  it("both bounds equal to the price include it; one cent either side excludes it", async () => {
    const product = await seedProduct("0.10", "0.30", storage);
    expect(ids(await mongoCatalogSearchPort.search({ minPrice: "0.30", maxPrice: "0.30" }))).toEqual([product._id.toString()]);
    expect(ids(await mongoCatalogSearchPort.search({ minPrice: "0.10", maxPrice: "0.10" }))).toEqual([product._id.toString()]);
    expect(ids(await mongoCatalogSearchPort.search({ minPrice: "0.31" }))).toEqual([]);
    expect(ids(await mongoCatalogSearchPort.search({ maxPrice: "0.09" }))).toEqual([]);
  });

  it("the filtered count agrees with the filtered page", async () => {
    await seedProduct("19.99", "19.99", storage);
    await seedProduct("20.00", "20.00", storage);
    const result = await mongoCatalogSearchPort.search({ minPrice: "19.99", maxPrice: "19.99" });
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
  });
});

describe("price filter, sort and facets over a mix of Double and Decimal128 records", () => {
  it("filters both kinds identically", async () => {
    const asDouble = await seedProduct("19.99", "19.99", "double");
    const asDecimal = await seedProduct("19.99", "19.99", "decimal128");
    await seedProduct("20.00", "25.00", "decimal128");
    const result = await mongoCatalogSearchPort.search({ minPrice: "19.99", maxPrice: "19.99" });
    expect(ids(result)).toEqual([asDouble._id.toString(), asDecimal._id.toString()].sort());
    expect(result.total).toBe(2);
  });

  it("never matches a product with no price, under either bound", async () => {
    await seedProduct(undefined, undefined);
    expect((await mongoCatalogSearchPort.search({ maxPrice: "1000.00" })).total).toBe(0);
    expect((await mongoCatalogSearchPort.search({ minPrice: "0.00" })).total).toBe(0);
  });

  it("sorts by price across both kinds", async () => {
    const c = await seedProduct("30.00", "30.00", "double");
    const a = await seedProduct("10.50", "10.50", "decimal128");
    const b = await seedProduct("19.99", "19.99", "double");
    const d = await seedProduct("45.00", "45.00", "decimal128");
    const ascending = await mongoCatalogSearchPort.search({ sort: "price_asc" });
    expect(ascending.data.map((p) => p._id.toString())).toEqual([a, b, c, d].map((p) => p._id.toString()));
  });

  it("equal prices tie identically whichever way each is stored — the newest-first tie-breaker decides, in both directions", async () => {
    const older = await seedProduct("19.99", "19.99", "decimal128");
    await new Promise((resolve) => setTimeout(resolve, 15));
    const newer = await seedProduct("19.99", "19.99", "double");
    for (const sort of ["price_asc", "price_desc"] as const) {
      const order = (await mongoCatalogSearchPort.search({ sort })).data.map((p) => p._id.toString());
      expect(order).toEqual([newer._id.toString(), older._id.toString()]);
    }
  });

  it("reports the price facet as two-decimal strings, exactly as before, from either kind", async () => {
    await seedProduct("19.50", "19.50", "double");
    await seedProduct("600.00", "600.00", "decimal128");
    expect((await mongoCatalogSearchPort.facets()).priceRange).toEqual({ min: "19.50", max: "600.00" });
  });

  it("returns listing prices on the wire as the same decimal strings for both kinds", async () => {
    await seedProduct("19.50", "19.50", "double");
    await seedProduct("19.50", "19.50", "decimal128");
    const wire = JSON.parse(JSON.stringify((await mongoCatalogSearchPort.search({})).data));
    expect(wire.map((p: { listing: { minActivePrice: unknown } }) => p.listing.minActivePrice)).toEqual(["19.5", "19.5"]);
  });
});
