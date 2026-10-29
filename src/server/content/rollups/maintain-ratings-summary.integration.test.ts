// @vitest-environment node
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { connectToDatabase } from "../../core/db/connect";
import { ReviewModel, buildReviewKey } from "../review.schema";
import { maintainRatingsSummary } from "./maintain-ratings-summary";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({}), ReviewModel.deleteMany({}), CustomerModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function seedProduct() {
  const category = await CategoryModel.create({ slug: "electronics" });
  return ProductModel.create({
    slug: `p-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "T", ar: "ت" },
  });
}

async function seedCustomer(phone: string) {
  return CustomerModel.create({ phone, passwordHash: "x", name: "Test Customer" });
}

async function recompute(productId: mongoose.Types.ObjectId) {
  await withTransaction(async (tx) => {
    await maintainRatingsSummary(productId);
    return tx.complete(undefined);
  });
}

describe("maintainRatingsSummary", () => {
  it("stays 0/0 with no reviews at all", async () => {
    const product = await seedProduct();
    await recompute(product._id);
    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.ratingsSummary).toEqual({ average: 0, count: 0 });
  });

  it("first approval: average equals that one rating, count is 1", async () => {
    const product = await seedProduct();
    const customer = await seedCustomer("+201000000001");
    await ReviewModel.create({ productId: product._id, customerId: customer._id, customerProductKey: buildReviewKey(customer._id, product._id), rating: 4, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "APPROVED" });

    await recompute(product._id);

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.ratingsSummary).toEqual({ average: 4, count: 1 });
  });

  it("multiple approved reviews average correctly", async () => {
    const product = await seedProduct();
    const [c1, c2, c3] = await Promise.all([
      seedCustomer("+201000000001"),
      seedCustomer("+201000000002"),
      seedCustomer("+201000000003"),
    ]);
    await ReviewModel.create([
      { productId: product._id, customerId: c1!._id, customerProductKey: buildReviewKey(c1!._id, product._id), rating: 5, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "APPROVED" },
      { productId: product._id, customerId: c2!._id, customerProductKey: buildReviewKey(c2!._id, product._id), rating: 3, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "APPROVED" },
      { productId: product._id, customerId: c3!._id, customerProductKey: buildReviewKey(c3!._id, product._id), rating: 4, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "APPROVED" },
    ]);

    await recompute(product._id);

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.ratingsSummary.count).toBe(3);
    expect(updated?.ratingsSummary.average).toBeCloseTo(4, 5); // (5+3+4)/3 = 4
  });

  it("a PENDING or REJECTED review never contributes", async () => {
    const product = await seedProduct();
    const [c1, c2] = await Promise.all([seedCustomer("+201000000001"), seedCustomer("+201000000002")]);
    await ReviewModel.create([
      { productId: product._id, customerId: c1!._id, customerProductKey: buildReviewKey(c1!._id, product._id), rating: 5, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "PENDING" },
      { productId: product._id, customerId: c2!._id, customerProductKey: buildReviewKey(c2!._id, product._id), rating: 1, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "REJECTED" },
    ]);

    await recompute(product._id);

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.ratingsSummary).toEqual({ average: 0, count: 0 });
  });

  it("rejecting a previously-approved review removes it from the average", async () => {
    const product = await seedProduct();
    const [c1, c2] = await Promise.all([seedCustomer("+201000000001"), seedCustomer("+201000000002")]);
    const review = await ReviewModel.create({ productId: product._id, customerId: c1!._id, customerProductKey: buildReviewKey(c1!._id, product._id), rating: 5, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "APPROVED" });
    await ReviewModel.create({ productId: product._id, customerId: c2!._id, customerProductKey: buildReviewKey(c2!._id, product._id), rating: 3, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "APPROVED" });
    await recompute(product._id);
    expect((await ProductModel.findById(product._id).lean())?.ratingsSummary).toEqual({ average: 4, count: 2 });

    // A moderator reverses the first review's approval.
    await ReviewModel.updateOne({ _id: review._id }, { $set: { status: "REJECTED" } });
    await recompute(product._id);

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.ratingsSummary).toEqual({ average: 3, count: 1 });
  });

  it("an edit-triggered re-moderation (status reset to PENDING) removes the review until re-approved", async () => {
    const product = await seedProduct();
    const customer = await seedCustomer("+201000000001");
    const review = await ReviewModel.create({ productId: product._id, customerId: customer._id, customerProductKey: buildReviewKey(customer._id, product._id), rating: 5, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "APPROVED" });
    await recompute(product._id);
    expect((await ProductModel.findById(product._id).lean())?.ratingsSummary.count).toBe(1);

    // The (future) edit route's contract: an edit to an approved review resets status to PENDING.
    await ReviewModel.updateOne({ _id: review._id }, { $set: { status: "PENDING", rating: 1 } });
    await recompute(product._id);
    expect((await ProductModel.findById(product._id).lean())?.ratingsSummary).toEqual({ average: 0, count: 0 });

    // Re-approved with the edited rating.
    await ReviewModel.updateOne({ _id: review._id }, { $set: { status: "APPROVED" } });
    await recompute(product._id);
    expect((await ProductModel.findById(product._id).lean())?.ratingsSummary).toEqual({ average: 1, count: 1 });
  });

  it("stays correct under concurrent recomputation for the same product", async () => {
    const product = await seedProduct();
    const customers = await Promise.all(Array.from({ length: 4 }, (_, i) => seedCustomer(`+20100000000${i}`)));
    const ratings: number[] = [5, 4, 3, 2];
    await Promise.all(
      customers.map((customer, i) =>
        ReviewModel.create({
          productId: product._id,
          customerId: customer!._id,
          customerProductKey: buildReviewKey(customer!._id, product._id),
          rating: ratings[i]!,
          title: { en: "x", ar: "x" },
          body: { en: "x", ar: "x" },
          status: "APPROVED",
        })
      )
    );

    await Promise.all(Array.from({ length: 5 }, () => recompute(product._id)));

    const updated = await ProductModel.findById(product._id).lean();
    expect(updated?.ratingsSummary.count).toBe(4);
    expect(updated?.ratingsSummary.average).toBeCloseTo(3.5, 5);
  });
});
