import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import { connectToDatabase } from "src/server/core/db/connect";
import { customerJwtConfig } from "src/server/core/auth/customer-jwt-config";
import { CUSTOMER_SESSION_COOKIE } from "src/server/core/auth/customer-session-cookies";
import { CustomerModel } from "src/server/identity/customer.schema";
import { ReviewModel } from "src/server/content/review.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { GET } = await import("./route");

async function createCustomer() {
  return CustomerModel.create({
    phone: `+2010${Math.floor(Math.random() * 100000000)}`,
    passwordHash: "irrelevant-for-this-test",
    name: "Test Customer",
    tokenVersion: 1,
  });
}

async function customerCookieHeader(customerId: string): Promise<Record<string, string>> {
  const token = await signAuthToken({ sub: customerId, tokenVersion: 1 }, undefined, customerJwtConfig());
  return { cookie: `${CUSTOMER_SESSION_COOKIE}=${token}` };
}

async function createReview(customerId: mongoose.Types.ObjectId, status: "PENDING" | "APPROVED" | "REJECTED") {
  const productId = new mongoose.Types.ObjectId();
  return ReviewModel.create({
    productId,
    customerId,
    customerProductKey: `${customerId.toString()}|${productId.toString()}`,
    rating: 4,
    title: { en: "Title", ar: "" },
    body: { en: "Body", ar: "" },
    status,
  });
}

describe("GET /api/shop/reviews/mine", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await CustomerModel.deleteMany({});
    await ReviewModel.deleteMany({});
  });

  it("returns only the authenticated customer's reviews across every status", async () => {
    const customer = await createCustomer();
    const otherCustomer = await createCustomer();

    await createReview(customer._id, "PENDING");
    await createReview(customer._id, "APPROVED");
    await createReview(customer._id, "REJECTED");
    await createReview(otherCustomer._id, "APPROVED");

    const request = new NextRequest("http://localhost/api/shop/reviews/mine", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(3);
    expect(body.map((r: { status: string }) => r.status).sort()).toEqual(["APPROVED", "PENDING", "REJECTED"]);
  });

  it("returns 401 when no auth cookie is present", async () => {
    const request = new NextRequest("http://localhost/api/shop/reviews/mine");

    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid pagination parameters", async () => {
    const customer = await createCustomer();

    const request = new NextRequest("http://localhost/api/shop/reviews/mine?limit=0", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
  });

  it("never exposes staff-only moderation fields", async () => {
    const customer = await createCustomer();
    const review = await createReview(customer._id, "REJECTED");
    await ReviewModel.updateOne(
      { _id: review._id },
      { $set: { moderatedBy: new mongoose.Types.ObjectId(), moderatedAt: new Date() } }
    );

    const request = new NextRequest("http://localhost/api/shop/reviews/mine", {
      headers: await customerCookieHeader(customer._id.toString()),
    });

    const response = await GET(request, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(body[0].moderatedBy).toBeUndefined();
    expect(body[0].moderatedAt).toBeUndefined();
  });
});
