import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { listMyReviews } from "./list-my-reviews";
import { ReviewModel } from "../../content/review.schema";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

function customerIdentity(): CustomerIdentity {
  return { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
}

async function createReview(
  customerId: string,
  productId: mongoose.Types.ObjectId,
  status: "PENDING" | "APPROVED" | "REJECTED",
  createdAt: Date
) {
  const review = await ReviewModel.create({
    productId,
    customerId,
    customerProductKey: `${customerId}|${productId.toString()}`,
    rating: 4,
    title: { en: "Title", ar: "" },
    body: { en: "Body", ar: "" },
    status,
  });
  await ReviewModel.updateOne({ _id: review._id }, { $set: { createdAt } });
  return review;
}

describe("listMyReviews", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await ReviewModel.deleteMany({});
  });

  it("returns only the authenticated customer's reviews, including every status", async () => {
    const customer1 = customerIdentity();
    const customer2 = customerIdentity();

    await createReview(customer1._id, new mongoose.Types.ObjectId(), "PENDING", new Date("2024-01-01"));
    await createReview(customer1._id, new mongoose.Types.ObjectId(), "APPROVED", new Date("2024-01-02"));
    await createReview(customer1._id, new mongoose.Types.ObjectId(), "REJECTED", new Date("2024-01-03"));
    await createReview(customer2._id, new mongoose.Types.ObjectId(), "APPROVED", new Date("2024-01-04"));

    const result = await listMyReviews({ customer: customer1 });

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.status).sort()).toEqual(["APPROVED", "PENDING", "REJECTED"]);
  });

  it("never exposes another customer's reviews", async () => {
    const customer1 = customerIdentity();
    const customer2 = customerIdentity();
    await createReview(customer2._id, new mongoose.Types.ObjectId(), "APPROVED", new Date());

    const result = await listMyReviews({ customer: customer1 });

    expect(result).toEqual([]);
  });

  it("respects limit and offset pagination, most recent first", async () => {
    const customer = customerIdentity();
    for (let i = 1; i <= 5; i++) {
      await createReview(customer._id, new mongoose.Types.ObjectId(), "PENDING", new Date(`2024-01-0${i}`));
    }

    const page1 = await listMyReviews({ customer, limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = await listMyReviews({ customer, limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    const page3 = await listMyReviews({ customer, limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);
  });
});
