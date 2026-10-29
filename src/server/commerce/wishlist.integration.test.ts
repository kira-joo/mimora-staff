// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { WishlistModel, buildWishlistKey } from "./wishlist.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase(); // asserts the unique index on customerProductKey exists
});

afterEach(async () => {
  await WishlistModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("Wishlist", () => {
  it("persists a customer-product pair with the derived key", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const productId = new mongoose.Types.ObjectId();

    const entry = await WishlistModel.create({ customerId, productId, customerProductKey: buildWishlistKey(customerId, productId) });

    expect(entry.customerProductKey).toBe(`${customerId.toString()}|${productId.toString()}`);
  });

  it("enforces at most one wishlist entry per (customer, product) — the whole reason customerProductKey exists", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const productId = new mongoose.Types.ObjectId();
    const key = buildWishlistKey(customerId, productId);

    await WishlistModel.create({ customerId, productId, customerProductKey: key });

    await expect(WishlistModel.create({ customerId, productId, customerProductKey: key })).rejects.toThrow();
  });

  it("the same product may be wishlisted by two different customers — the key is per-pair, not per-product", async () => {
    const productId = new mongoose.Types.ObjectId();
    const customerA = new mongoose.Types.ObjectId();
    const customerB = new mongoose.Types.ObjectId();

    await WishlistModel.create({ customerId: customerA, productId, customerProductKey: buildWishlistKey(customerA, productId) });
    await expect(
      WishlistModel.create({ customerId: customerB, productId, customerProductKey: buildWishlistKey(customerB, productId) })
    ).resolves.toBeDefined();
  });

  it("race safety: concurrent attempts to wishlist the same pair leave exactly one document", async () => {
    const customerId = new mongoose.Types.ObjectId();
    const productId = new mongoose.Types.ObjectId();
    const key = buildWishlistKey(customerId, productId);

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => WishlistModel.create({ customerId, productId, customerProductKey: key }))
    );

    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(await WishlistModel.countDocuments({ customerProductKey: key })).toBe(1);
  });
});
