import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { connectToDatabase } from "../../core/db/connect";
import { CustomerModel } from "../../identity/customer.schema";
import { NewsletterSubscriberModel } from "../../newsletter/newsletter-subscriber.schema";
import { newsletterSubscriberRepository } from "../../core/repositories";
import { updateProfile } from "./update-profile";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("updateProfile", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await Promise.all([CustomerModel.deleteMany({}), NewsletterSubscriberModel.deleteMany({})]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("updates customer name and email", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000001",
      email: "old@example.com",
      passwordHash: "hash",
      name: "Old Name",
    });

    const updated = await updateProfile(customer._id.toString(), {
      name: "New Name",
      email: "new@example.com",
    });

    expect(updated.name).toBe("New Name");
    expect(updated.email).toBe("new@example.com");

    const dbCustomer = await CustomerModel.findById(customer._id);
    expect(dbCustomer?.name).toBe("New Name");
    expect(dbCustomer?.email).toBe("new@example.com");
  });

  it("a CHANGED email is unverified again, and the old address's pending verification token is cleared", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000011",
      email: "verified@example.com",
      emailVerified: true,
      emailVerificationTokenHash: "hash-for-the-old-address",
      emailVerificationExpiresAt: new Date(Date.now() + 3_600_000),
      passwordHash: "hash",
      name: "Verified",
    });

    const updated = await updateProfile(customer._id.toString(), { name: "Verified", email: "different@example.com" });

    expect(updated.emailVerified).toBe(false);
    const stored = await CustomerModel.findById(customer._id).select("+emailVerificationTokenHash +emailVerificationExpiresAt").lean();
    expect(stored?.emailVerified).toBe(false);
    expect(stored?.emailVerificationTokenHash).toBeUndefined();
    expect(stored?.emailVerificationExpiresAt).toBeUndefined();
  });

  it("an UNCHANGED email (same address, or differing only in case) or no email keeps the verification", async () => {
    const customer = await CustomerModel.create({ phone: "+201000000012", email: "verified@example.com", emailVerified: true, passwordHash: "hash", name: "Verified" });

    expect((await updateProfile(customer._id.toString(), { name: "Renamed", email: "verified@example.com" })).emailVerified).toBe(true);
    expect((await updateProfile(customer._id.toString(), { name: "Renamed", email: "Verified@Example.com" })).emailVerified).toBe(true);
    expect((await updateProfile(customer._id.toString(), { name: "Renamed Again" })).emailVerified).toBe(true);
    expect((await CustomerModel.findById(customer._id).lean())?.emailVerified).toBe(true);
  });

  it("updates name only when email is undefined", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000002",
      email: "keep@example.com",
      passwordHash: "hash",
      name: "Old Name",
    });

    const updated = await updateProfile(customer._id.toString(), {
      name: "Updated Name",
      email: undefined,
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.email).toBe("keep@example.com");
  });

  it("throws ConflictError when email is taken by another customer", async () => {
    await CustomerModel.create({
      phone: "+201000000003",
      email: "taken@example.com",
      passwordHash: "hash",
      name: "Customer 1",
    });

    const customer2 = await CustomerModel.create({
      phone: "+201000000004",
      email: "other@example.com",
      passwordHash: "hash",
      name: "Customer 2",
    });

    await expect(
      updateProfile(customer2._id.toString(), {
        name: "Customer 2",
        email: "taken@example.com",
      })
    ).rejects.toThrow(ConflictError);
    await expect(
      updateProfile(customer2._id.toString(), {
        name: "Customer 2",
        email: "taken@example.com",
      })
    ).rejects.toThrow("This email is already registered to another account.");
  });

  it("allows updating to the same email (own email)", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000005",
      email: "mine@example.com",
      passwordHash: "hash",
      name: "My Name",
    });

    const updated = await updateProfile(customer._id.toString(), {
      name: "Updated Name",
      email: "mine@example.com",
    });

    expect(updated.email).toBe("mine@example.com");
    expect(updated.name).toBe("Updated Name");
  });

  it("trims and lowercases email", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000007",
      passwordHash: "hash",
      name: "Test",
    });

    const updated = await updateProfile(customer._id.toString(), {
      name: "Test",
      email: "  UPPER@EXAMPLE.COM  ",
    });

    expect(updated.email).toBe("upper@example.com");
  });

  it("throws when customer does not exist", async () => {
    const nonExistentId = new mongoose.Types.ObjectId();
    await expect(
      updateProfile(nonExistentId.toString(), {
        name: "Test",
        email: "test@example.com",
      })
    ).rejects.toThrow("Customer not found");
  });

  describe("marketing consent follows the email", () => {
    const consentedCustomer = async (phone: string, email: string, granted = true) => {
      const customer = await CustomerModel.create({ phone, email, passwordHash: "hash", name: "Mona", ...(granted ? { marketingConsent: { granted: true, at: new Date(), source: "account" } } : {}) });
      if (granted) await NewsletterSubscriberModel.create({ email, source: "account", status: "SUBSCRIBED", consentedAt: new Date(), customerId: customer._id });
      return customer;
    };

    it("moves the subscription: the old address is unsubscribed, the new one subscribed and linked to the account", async () => {
      const customer = await consentedCustomer("+201000000010", "old@example.com");
      await updateProfile(customer._id.toString(), { name: "Mona", email: "New@Example.com" });

      expect(await NewsletterSubscriberModel.findOne({ email: "old@example.com" }).lean()).toMatchObject({ status: "UNSUBSCRIBED" });
      const next = await NewsletterSubscriberModel.findOne({ email: "new@example.com" }).lean();
      expect(next).toMatchObject({ status: "SUBSCRIBED", source: "account" });
      expect(next?.customerId?.toString()).toBe(customer._id.toString());
      expect(next?.consentedAt).toBeInstanceOf(Date);
    });

    it("does nothing to the newsletter when consent is not granted", async () => {
      const customer = await consentedCustomer("+201000000011", "old@example.com", false);
      await NewsletterSubscriberModel.create({ email: "old@example.com", source: "footer", status: "SUBSCRIBED", consentedAt: new Date() });
      await updateProfile(customer._id.toString(), { name: "Mona", email: "new@example.com" });

      expect(await NewsletterSubscriberModel.countDocuments({ email: "new@example.com" })).toBe(0);
      expect(await NewsletterSubscriberModel.findOne({ email: "old@example.com" }).lean()).toMatchObject({ status: "SUBSCRIBED" });
    });

    it("does nothing when only the name changes, or the email is re-sent unchanged or in another case", async () => {
      const customer = await consentedCustomer("+201000000012", "same@example.com");
      await updateProfile(customer._id.toString(), { name: "Renamed" });
      await updateProfile(customer._id.toString(), { name: "Renamed", email: "same@example.com" });
      await updateProfile(customer._id.toString(), { name: "Renamed", email: "SAME@example.com" });
      expect(await NewsletterSubscriberModel.find({}).lean()).toHaveLength(1);
      expect(await NewsletterSubscriberModel.findOne({ email: "same@example.com" }).lean()).toMatchObject({ status: "SUBSCRIBED" });
    });

    it("a new address that was unsubscribed before is subscribed again: the account holder's own consent", async () => {
      const customer = await consentedCustomer("+201000000013", "old@example.com");
      await NewsletterSubscriberModel.create({ email: "back@example.com", source: "footer", status: "UNSUBSCRIBED", consentedAt: new Date(), unsubscribedAt: new Date() });
      await updateProfile(customer._id.toString(), { name: "Mona", email: "back@example.com" });
      expect(await NewsletterSubscriberModel.findOne({ email: "back@example.com" }).lean()).toMatchObject({ status: "SUBSCRIBED" });
    });

    it("ROLLBACK: if the move fails, the email, the old subscription and the new one are all left untouched", async () => {
      const customer = await consentedCustomer("+201000000014", "old@example.com");
      vi.spyOn(newsletterSubscriberRepository, "updateAtomic").mockRejectedValueOnce(new Error("boom"));

      await expect(updateProfile(customer._id.toString(), { name: "Changed", email: "new@example.com" })).rejects.toThrow("boom");

      const stored = await CustomerModel.findById(customer._id).lean();
      expect(stored).toMatchObject({ email: "old@example.com", name: "Mona" });
      expect(await NewsletterSubscriberModel.findOne({ email: "old@example.com" }).lean()).toMatchObject({ status: "SUBSCRIBED" });
      expect(await NewsletterSubscriberModel.countDocuments({ email: "new@example.com" })).toBe(0);
    });

    it("a conflicting email changes nothing", async () => {
      const customer = await consentedCustomer("+201000000015", "old@example.com");
      await CustomerModel.create({ phone: "+201000000016", email: "taken@example.com", passwordHash: "hash", name: "Other" });
      await expect(updateProfile(customer._id.toString(), { name: "Mona", email: "taken@example.com" })).rejects.toThrow(ConflictError);
      expect(await NewsletterSubscriberModel.findOne({ email: "old@example.com" }).lean()).toMatchObject({ status: "SUBSCRIBED" });
      expect(await NewsletterSubscriberModel.countDocuments({ email: "taken@example.com" })).toBe(0);
    });
  });
});
