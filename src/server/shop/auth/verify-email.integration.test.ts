// @vitest-environment node
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CustomerModel } from "../../identity/customer.schema";
import { hashVerificationToken } from "./hash-verification-token";
import { verifyEmail } from "./verify-email";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CustomerModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function createCustomerWithVerificationToken(overrides: { expired?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const customer = await CustomerModel.create({
    phone: `+2010${Math.floor(Math.random() * 100000000)}`,
    email: `customer-${Math.floor(Math.random() * 100000000)}@example.com`,
    passwordHash: "x",
    name: "Test Customer",
    emailVerificationTokenHash: hashVerificationToken(token),
    emailVerificationExpiresAt: new Date(Date.now() + (overrides.expired ? -1000 : 60 * 60 * 1000)),
  });
  return { customer, token };
}

describe("verifyEmail", () => {
  it("marks the email verified and clears the token", async () => {
    const { customer, token } = await createCustomerWithVerificationToken();

    await verifyEmail(token);

    const updated = await CustomerModel.findById(customer._id).select("+emailVerificationTokenHash +emailVerificationExpiresAt").lean();  // explicit: these fields are select: false
    expect(updated?.emailVerified).toBe(true);
    expect(updated?.emailVerificationTokenHash).toBeUndefined();
    expect(updated?.emailVerificationExpiresAt).toBeUndefined();
  });

  it("rejects an expired token", async () => {
    const { token } = await createCustomerWithVerificationToken({ expired: true });
    await expect(verifyEmail(token)).rejects.toThrow(/invalid or has expired/);
  });

  it("rejects an unknown token", async () => {
    await expect(verifyEmail("not-a-real-token")).rejects.toThrow(/invalid or has expired/);
  });

  it("is single-use", async () => {
    const { token } = await createCustomerWithVerificationToken();

    await verifyEmail(token);

    await expect(verifyEmail(token)).rejects.toThrow(/invalid or has expired/);
  });
});
