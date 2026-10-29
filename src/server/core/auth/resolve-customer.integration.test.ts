// @vitest-environment node
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../db/connect";
import { CustomerModel } from "../../identity/customer.schema";
import { customerJwtConfig } from "./customer-jwt-config";
import { resolveCustomerFromAccessToken } from "./resolve-customer";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CustomerModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function createCustomer(tokenVersion = 1) {
  const customer = await CustomerModel.create({
    phone: `+2010${Math.floor(Math.random() * 100000000)}`,
    passwordHash: "irrelevant-for-this-test",
    name: "Test Customer",
    tokenVersion,
  });
  return customer;
}

describe("resolveCustomerFromAccessToken", () => {
  it("resolves a valid token to the customer it names", async () => {
    const customer = await createCustomer(1);
    const token = await signAuthToken({ sub: customer._id.toString(), tokenVersion: 1 }, undefined, customerJwtConfig());

    const identity = await resolveCustomerFromAccessToken(token);
    expect(identity._id).toBe(customer._id.toString());
    expect(identity.phone).toBe(customer.phone);
  });

  it("rejects a token for a customer that no longer exists", async () => {
    const token = await signAuthToken(
      { sub: new mongoose.Types.ObjectId().toString(), tokenVersion: 1 },
      undefined,
      customerJwtConfig()
    );
    await expect(resolveCustomerFromAccessToken(token)).rejects.toThrow();
  });

  it("rejects a token whose tokenVersion is stale — a password change bumps it immediately", async () => {
    const customer = await createCustomer(2); // stored version is now 2
    const token = await signAuthToken(
      { sub: customer._id.toString(), tokenVersion: 1 }, // token still carries the old version
      undefined,
      customerJwtConfig()
    );
    await expect(resolveCustomerFromAccessToken(token)).rejects.toThrow();
  });

  it("rejects a token signed with a different secret — the two audiences never share one", async () => {
    const customer = await createCustomer(1);
    const token = await signAuthToken(
      { sub: customer._id.toString(), tokenVersion: 1 },
      undefined,
      { secret: "a-completely-different-secret-at-least-32-chars" }
    );
    await expect(resolveCustomerFromAccessToken(token)).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    await expect(resolveCustomerFromAccessToken("not-a-real-token")).rejects.toThrow();
  });
});
