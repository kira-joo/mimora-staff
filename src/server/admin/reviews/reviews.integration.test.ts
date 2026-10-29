import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { ReviewModel, buildReviewKey } from "../../content/review.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { listReviews } from "./list-reviews";
import { moderateReview } from "./moderate-review";
import { productRepository } from "../../core/repositories";
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

async function seedProduct() {
  const category = await CategoryModel.create({ slug: `cat-${new mongoose.Types.ObjectId().toString()}` });
  return ProductModel.create({
    slug: `product-${new mongoose.Types.ObjectId().toString()}`,
    categoryId: category._id,
    lifecycle: "published",
    name: { en: "Test", ar: "تجربة" },
  });
}

async function seedReview(productId: mongoose.Types.ObjectId, overrides: Partial<{ rating: number; status: "PENDING" | "APPROVED" | "REJECTED"; customerId: mongoose.Types.ObjectId }> = {}) {
  const customerId = overrides.customerId ?? new mongoose.Types.ObjectId();
  return ReviewModel.create({
    productId,
    customerId,
    customerProductKey: buildReviewKey(customerId, productId),
    rating: overrides.rating ?? 5,
    title: { ar: "رائع", en: "Great" },
    body: { ar: "منتج رائع", en: "Great product" },
    status: overrides.status ?? "PENDING",
  });
}

describe("Admin Reviews", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([ReviewModel.deleteMany({}), ProductModel.deleteMany({}), CategoryModel.deleteMany({})]);
  });

  describe("listReviews", () => {
    it("filters by status and productId", async () => {
      const product = await seedProduct();
      await seedReview(product._id, { status: "PENDING" });
      await seedReview(product._id, { status: "APPROVED" });

      const pending = await listReviews({ limit: 10, page: 1, status: "PENDING" });
      expect(pending.total).toBe(1);

      const byProduct = await listReviews({ limit: 10, page: 1, productId: product._id.toString() });
      expect(byProduct.total).toBe(2);
    });

    it("carries the product's and the reviewer's names — and nothing else of the customer", async () => {
      const product = await seedProduct();
      const customer = await CustomerModel.create({
        name: "منى Mona",
        phone: `+2010${Math.floor(Math.random() * 100000000)}`,
        email: `mona-${new mongoose.Types.ObjectId()}@example.com`,
        passwordHash: "argon-hash",
        passwordResetTokenHash: "must-not-leak",
      });
      await seedReview(product._id, { customerId: customer._id });

      const [row] = (await listReviews({ limit: 10, page: 1 })).data;
      expect(row?.productName).toEqual({ en: "Test", ar: "تجربة" });
      expect(row?.customerName).toBe("منى Mona");
      const serialized = JSON.stringify(row);
      for (const secret of ["must-not-leak", "argon-hash", customer.phone, customer.email!]) expect(serialized).not.toContain(secret);
      await CustomerModel.deleteMany({ _id: customer._id });
    });

    it("falls back to empty names when the product or customer is gone", async () => {
      const product = await seedProduct();
      await seedReview(product._id);
      await ProductModel.deleteMany({ _id: product._id });

      const [row] = (await listReviews({ limit: 10, page: 1 })).data;
      expect(row?.productName).toEqual({ ar: "", en: "" });
      expect(row?.customerName).toBe("");
    });
  });

  describe("moderateReview", () => {
    it("approves a pending review and updates the product's ratings summary", async () => {
      const product = await seedProduct();
      const review = await seedReview(product._id, { rating: 4 });
      const staffId = new mongoose.Types.ObjectId().toString();

      const updated = await moderateReview({ reviewId: review._id.toString(), status: "APPROVED", staffId, now: new Date() });
      expect(updated.status).toBe("APPROVED");
      expect(updated.moderatedBy?.toString()).toBe(staffId);

      const productAfter = await ProductModel.findById(product._id).lean();
      expect(productAfter?.ratingsSummary.count).toBe(1);
      expect(productAfter?.ratingsSummary.average).toBe(4);
    });

    it("rejecting a previously-approved review removes it from the ratings summary", async () => {
      const product = await seedProduct();
      const review = await seedReview(product._id, { rating: 5, status: "APPROVED" });
      await ProductModel.updateOne({ _id: product._id }, { $set: { "ratingsSummary.average": 5, "ratingsSummary.count": 1 } });

      await moderateReview({ reviewId: review._id.toString(), status: "REJECTED", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() });

      const productAfter = await ProductModel.findById(product._id).lean();
      expect(productAfter?.ratingsSummary.count).toBe(0);
    });

    it("rolls back the review status change when the ratings-summary write fails", async () => {
      const product = await seedProduct();
      const review = await seedReview(product._id, { rating: 4 });
      failAfterWrite(productRepository, "updateAtomic", 1); // the summary write, last in the transaction

      await expect(
        moderateReview({ reviewId: review._id.toString(), status: "APPROVED", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow("injected failure");

      const reviewAfter = await ReviewModel.findById(review._id).lean();
      expect(reviewAfter?.status).toBe("PENDING");
      expect(reviewAfter?.moderatedBy).toBeUndefined();
      expect(reviewAfter?.moderatedAt).toBeUndefined();
      const productAfter = await ProductModel.findById(product._id).lean();
      expect(productAfter?.ratingsSummary.count).toBe(0);
      expect(productAfter?.ratingsSummary.average).toBe(0);
    });

    it("throws ConflictError when moderating to the review's current status", async () => {
      const product = await seedProduct();
      const review = await seedReview(product._id, { status: "APPROVED" });

      await expect(
        moderateReview({ reviewId: review._id.toString(), status: "APPROVED", staffId: new mongoose.Types.ObjectId().toString(), now: new Date() })
      ).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent review", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(
        moderateReview({ reviewId: fakeId, status: "APPROVED", staffId: fakeId, now: new Date() })
      ).rejects.toThrow(NotFoundError);
    });
  });
});
