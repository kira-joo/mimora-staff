import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CustomerModel } from "../../identity/customer.schema";
import { getProfile } from "./get-profile";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("getProfile", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await CustomerModel.deleteMany({});
  });

  it("returns the customer's profile with public fields", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000001",
      email: "test@example.com",
      passwordHash: "hash",
      name: "Test Customer",
    });

    const profile = await getProfile(customer._id.toString());

    expect(profile).toMatchObject({
      _id: customer._id.toString(),
      name: "Test Customer",
      phone: "+201000000001",
      email: "test@example.com",
      phoneVerified: false,
      emailVerified: false,
    });
    expect(profile.createdAt).toBeInstanceOf(Date);
    expect(profile.updatedAt).toBeInstanceOf(Date);
  });

  it("handles customer without email", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000002",
      passwordHash: "hash",
      name: "No Email Customer",
    });

    const profile = await getProfile(customer._id.toString());

    expect(profile.email).toBeUndefined();
    expect(profile.name).toBe("No Email Customer");
  });

  it("throws when customer does not exist", async () => {
    const nonExistentId = new mongoose.Types.ObjectId();
    await expect(getProfile(nonExistentId.toString())).rejects.toThrow("Customer not found");
  });
});
