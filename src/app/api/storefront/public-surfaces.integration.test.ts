import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { toMoney } from "@kira-joo/toolkit-common";
import { connectToDatabase } from "src/server/core/db/connect";
import { PromotionModel } from "src/server/commerce/promotion.schema";
import { ReviewModel, buildReviewKey } from "src/server/content/review.schema";
import { CustomerModel } from "src/server/identity/customer.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const promotionsRoute = (await import("./promotions/active/route")).GET as unknown as Handler;
const reviewsRoute = (await import("./reviews/[productId]/route")).GET as unknown as Handler;

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([PromotionModel.deleteMany({}), ReviewModel.deleteMany({}), CustomerModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

const LOCALIZED = { en: "x", ar: "س" };

describe("GET /api/storefront/promotions/active — public contract", () => {
  it("lists only automatic promotions, projected to display-safe fields", async () => {
    await PromotionModel.create([
      {
        name: { en: "Auto 10", ar: "تلقائي" },
        description: LOCALIZED,
        type: "PERCENT",
        value: toMoney("10"),
        conditions: { minSubtotal: toMoney("100"), categories: [new mongoose.Types.ObjectId()], collections: [], products: [], variants: [], firstOrderOnly: false },
        limits: { totalUses: 5, perCustomerUses: 1 },
        usageCount: 3,
        active: true,
      },
      { code: "SECRET20", name: LOCALIZED, description: LOCALIZED, type: "PERCENT", value: toMoney("20"), conditions: { categories: [], collections: [], products: [], variants: [], firstOrderOnly: false }, active: true },
    ]);

    const response = await promotionsRoute(new NextRequest("http://localhost/api/storefront/promotions/active"), { params: Promise.resolve({}) });
    const body = (await response.json()) as Record<string, unknown>[];
    const text = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(text).not.toContain("SECRET20");
    expect(Object.keys(body[0]!).sort()).toEqual(["_id", "description", "minSubtotal", "name", "scope", "type", "value"]);
    expect(body[0]).toMatchObject({ type: "PERCENT", value: "10", minSubtotal: "100", name: { en: "Auto 10", ar: "تلقائي" } });
    for (const forbidden of ["code", "usageCount", "limits", "conditions", "stackable", "active", "firstOrderOnly"]) {
      expect(body[0]).not.toHaveProperty(forbidden);
    }
  });
});

describe("GET /api/storefront/reviews/[productId] — public contract", () => {
  it("returns approved reviews projected to the public fields only", async () => {
    const productId = new mongoose.Types.ObjectId();
    const customer = await CustomerModel.create({ phone: "+201000000077", passwordHash: "x", name: "Reviewer" });
    await ReviewModel.create({
      productId,
      customerId: customer._id,
      customerProductKey: buildReviewKey(customer._id, productId),
      orderId: new mongoose.Types.ObjectId(),
      rating: 5,
      title: { en: "Great", ar: "رائع" },
      body: LOCALIZED,
      status: "APPROVED",
      verifiedPurchase: true,
      moderatedBy: new mongoose.Types.ObjectId(),
      moderatedAt: new Date(),
    });

    const response = await reviewsRoute(new NextRequest(`http://localhost/api/storefront/reviews/${productId}`), { params: Promise.resolve({ productId: productId.toString() }) });
    const body = (await response.json()) as { data: Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(Object.keys(body.data[0]!).sort()).toEqual(["_id", "body", "createdAt", "rating", "title", "verifiedPurchase"]);
    expect(body.data[0]).toMatchObject({ rating: 5, verifiedPurchase: true, title: { en: "Great", ar: "رائع" } });
    expect(JSON.stringify(body)).not.toContain(customer._id.toString());
  });
});
