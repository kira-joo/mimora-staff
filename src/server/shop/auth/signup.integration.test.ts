// @vitest-environment node
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { consentEventRepository, newsletterSubscriberRepository } from "../../core/repositories";
import { failAfterWrite, restoreInjectedFailures, snapshotCollections } from "../../core/test-support/rollback-injection";
import { ConsentEventModel } from "../../identity/consent-event.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { NewsletterSubscriberModel } from "../../newsletter/newsletter-subscriber.schema";
import { signupCustomer } from "./signup";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  restoreInjectedFailures();
  await Promise.all([CustomerModel.deleteMany({}), ConsentEventModel.deleteMany({}), NewsletterSubscriberModel.deleteMany({})]);
  delete process.env.STORE_PHONE_COUNTRY_CODE;
});

afterAll(async () => {
  await mongoose.disconnect();
});

const rand = () => Math.floor(Math.random() * 100000000);

/** `signupCustomer` never reveals existence: it resolves for new and registered alike, and returns nothing. The HTTP-level identity is asserted in `signup-enumeration.integration.test.ts`. */
describe("signupCustomer", () => {
  it("creates the account for an unregistered phone and returns nothing", async () => {
    const phone = `+2010${rand()}`;
    await expect(signupCustomer({ phone, password: "a-real-password", name: "New Customer" })).resolves.toBeUndefined();
    expect((await CustomerModel.findOne({ phone }))?.name).toBe("New Customer");
  });

  it("silently does nothing for a registered phone — existing account untouched", async () => {
    const phone = `+2010${rand()}`;
    const original = await hashPassword("original-password");
    await CustomerModel.create({ phone, passwordHash: original, name: "Existing Customer" });

    await expect(signupCustomer({ phone, password: "attacker-password", name: "Attacker" })).resolves.toBeUndefined();

    const after = await CustomerModel.findOne({ phone }).select("+passwordHash");
    expect(await CustomerModel.countDocuments({})).toBe(1);
    expect(after?.name).toBe("Existing Customer");
    expect(after?.passwordHash).toBe(original);
  });

  it("silently does nothing for a registered email even when the phone is new", async () => {
    const email = `existing-${rand()}@example.com`;
    await CustomerModel.create({ phone: `+2010${rand()}`, email, passwordHash: await hashPassword("x"), name: "Existing Customer" });

    await expect(signupCustomer({ phone: `+2011${rand()}`, email: email.toUpperCase(), password: "a-real-password", name: "New Customer" })).resolves.toBeUndefined();
    expect(await CustomerModel.countDocuments({})).toBe(1);
  });

  it("treats a legacy-stored form of the same number as already registered", async () => {
    process.env.STORE_PHONE_COUNTRY_CODE = "20";
    await CustomerModel.create({ phone: "01012345678", passwordHash: await hashPassword("x"), name: "Legacy" });
    await signupCustomer({ phone: "+201012345678", password: "a-real-password", name: "Twin" });
    expect(await CustomerModel.countDocuments({})).toBe(1);
  });
});

describe("signupCustomer rollback — the account, its consent and the newsletter row are one write", () => {
  const signup = () => signupCustomer({ phone: `+2010${rand()}`, email: `rollback-${rand()}@example.com`, password: "a-real-password", name: "Rolled Back", marketingConsent: true, locale: "en" });

  it("a failure after the LAST write (newsletter reactivation) leaves no customer, no consent event and no subscriber", async () => {
    // A pre-existing, unrelated subscriber proves the rollback restores the collection, not merely empties it.
    await NewsletterSubscriberModel.create({ email: "bystander@example.com", locale: "ar", source: "footer", status: "SUBSCRIBED", consentedAt: new Date() });
    const before = await snapshotCollections(CustomerModel, ConsentEventModel, NewsletterSubscriberModel);
    // subscribeToNewsletter writes twice (upsert, then reactivate); the 2nd is the last write of the transaction.
    const writes = failAfterWrite(newsletterSubscriberRepository, "updateAtomic", 2);

    await expect(signup()).rejects.toThrow("injected failure");

    expect(writes.calls).toBe(2); // the customer, the consent event and the upsert had all really been written
    expect(await snapshotCollections(CustomerModel, ConsentEventModel, NewsletterSubscriberModel)).toEqual(before);
  });

  it("a failure right after the consent event (customer and event written, newsletter not yet) leaves nothing either", async () => {
    const before = await snapshotCollections(CustomerModel, ConsentEventModel, NewsletterSubscriberModel);
    failAfterWrite(consentEventRepository, "save", 1);

    await expect(signup()).rejects.toThrow("injected failure");

    expect(await snapshotCollections(CustomerModel, ConsentEventModel, NewsletterSubscriberModel)).toEqual(before);
  });
});
