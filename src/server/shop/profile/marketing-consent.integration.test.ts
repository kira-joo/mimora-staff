// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import { connectToDatabase } from "../../core/db/connect";
import { newsletterSubscriberRepository } from "../../core/repositories";
import { failAfterWrite, restoreInjectedFailures, snapshotCollections } from "../../core/test-support/rollback-injection";
import { CustomerModel } from "../../identity/customer.schema";
import { ConsentEventModel } from "../../identity/consent-event.schema";
import { NewsletterSubscriberModel } from "../../newsletter/newsletter-subscriber.schema";
import { signupCustomer } from "../auth/signup";
import { getProfile } from "./get-profile";
import { setMarketingConsent } from "./marketing-consent";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  process.env.STORE_PHONE_COUNTRY_CODE = "20";
  await Promise.all([CustomerModel.deleteMany({}), ConsentEventModel.deleteMany({}), NewsletterSubscriberModel.deleteMany({})]);
});
afterEach(restoreInjectedFailures);
afterAll(async () => {
  delete process.env.STORE_PHONE_COUNTRY_CODE;
  await Promise.all([CustomerModel.deleteMany({}), ConsentEventModel.deleteMany({}), NewsletterSubscriberModel.deleteMany({})]);
  await mongoose.disconnect();
});

async function customer(email?: string) {
  return CustomerModel.create({ phone: `+2010${Math.floor(Math.random() * 100000000)}`, email, passwordHash: await hashPassword("password-1234"), name: "Mona" });
}

describe("marketing consent", () => {
  it("defaults to NOT granted — never asked is not consent", async () => {
    const c = await customer("a@example.com");
    expect((await getProfile(c._id.toString())).marketingConsent).toEqual({ granted: false });
    expect((await CustomerModel.findById(c._id).lean())?.marketingConsent).toBeUndefined();
  });

  it("signup without the checkbox records nothing; with it records granted/source=signup, an event and the subscriber", async () => {
    await signupCustomer({ phone: "+201005550201", password: "password-1234", name: "No", email: "no@example.com" });
    await signupCustomer({ phone: "+201005550202", password: "password-1234", name: "Yes", email: "yes@example.com", marketingConsent: true, locale: "en" });

    const no = await CustomerModel.findOne({ phone: "+201005550201" }).lean();
    const yes = await CustomerModel.findOne({ phone: "+201005550202" }).lean();
    expect(no?.marketingConsent).toBeUndefined();
    expect(yes?.marketingConsent).toMatchObject({ granted: true, source: "signup" });
    expect(yes?.marketingConsent?.at).toBeInstanceOf(Date);
    expect(await ConsentEventModel.countDocuments({ customerId: no?._id })).toBe(0);
    expect(await ConsentEventModel.countDocuments({ customerId: yes?._id, granted: true, source: "signup" })).toBe(1);
    expect(await NewsletterSubscriberModel.findOne({ email: "no@example.com" })).toBeNull();
    expect(await NewsletterSubscriberModel.findOne({ email: "yes@example.com" })).toMatchObject({ status: "SUBSCRIBED", locale: "en", source: "signup" });
  });

  it("an existing account's consent is untouched by a repeat signup", async () => {
    await signupCustomer({ phone: "+201005550203", password: "password-1234", name: "First" });
    await signupCustomer({ phone: "+201005550203", password: "password-1234", name: "Again", marketingConsent: true });
    expect((await CustomerModel.findOne({ phone: "+201005550203" }).lean())?.marketingConsent).toBeUndefined();
  });

  it("grant then withdraw: state, timestamps, source and a two-row history", async () => {
    const c = await customer("m@example.com");
    const id = c._id.toString();
    const granted = await setMarketingConsent(id, { granted: true, source: "account" });
    expect(granted).toMatchObject({ granted: true, source: "account" });
    const withdrawn = await setMarketingConsent(id, { granted: false, source: "account" });
    expect(withdrawn.granted).toBe(false);
    expect(withdrawn.at!.getTime()).toBeGreaterThanOrEqual(granted.at!.getTime());
    const events = await ConsentEventModel.find({ customerId: c._id }).sort({ at: 1 }).lean();
    expect(events.map((e) => e.granted)).toEqual([true, false]);
    expect((await getProfile(id)).marketingConsent.granted).toBe(false);
  });

  it("is idempotent: repeating the current state writes no event and does not move `at`", async () => {
    const c = await customer("i@example.com");
    const first = await setMarketingConsent(c._id.toString(), { granted: true, source: "checkout" });
    const again = await setMarketingConsent(c._id.toString(), { granted: true, source: "account" });
    expect(again.at).toEqual(first.at);
    expect(again.source).toBe("checkout");
    expect(await ConsentEventModel.countDocuments({ customerId: c._id })).toBe(1);
    // Withdrawing when never granted is a no-op too.
    const other = await customer("j@example.com");
    expect((await setMarketingConsent(other._id.toString(), { granted: false, source: "account" })).granted).toBe(false);
    expect(await ConsentEventModel.countDocuments({ customerId: other._id })).toBe(0);
  });

  it("withdrawing consent unsubscribes the newsletter row; granting again re-subscribes it", async () => {
    const c = await customer("n@example.com");
    const id = c._id.toString();
    await setMarketingConsent(id, { granted: true, source: "account" });
    expect(await NewsletterSubscriberModel.findOne({ email: "n@example.com" })).toMatchObject({ status: "SUBSCRIBED" });
    await setMarketingConsent(id, { granted: false, source: "account" });
    const row = await NewsletterSubscriberModel.findOne({ email: "n@example.com" }).lean();
    expect(row?.status).toBe("UNSUBSCRIBED");
    expect(row?.unsubscribedAt).toBeInstanceOf(Date);
    await setMarketingConsent(id, { granted: true, source: "account" });
    const back = await NewsletterSubscriberModel.findOne({ email: "n@example.com" }).lean();
    expect(back?.status).toBe("SUBSCRIBED");
    expect(back?.unsubscribedAt).toBeUndefined();
  });

  it("round-trips the hand-written sub-schema: every field survives a save and reload", async () => {
    const at = new Date("2026-01-02T03:04:05.000Z");
    const c = await CustomerModel.create({ phone: "+201005550299", passwordHash: "x", name: "RT", marketingConsent: { granted: true, at, source: "newsletter" }, redactedAt: at });
    const loaded = await CustomerModel.findById(c._id).lean();
    expect(loaded?.marketingConsent).toEqual({ granted: true, at, source: "newsletter" });
    expect(loaded?.redactedAt).toEqual(at);
    await expect(CustomerModel.create({ phone: "+201005550298", passwordHash: "x", name: "Bad", marketingConsent: { granted: true, at, source: "carrier-pigeon" as never } })).rejects.toThrow();
  });

  describe("rollback — the customer's state, the event and the newsletter row move together or not at all", () => {
    const all = () => snapshotCollections(CustomerModel, ConsentEventModel, NewsletterSubscriberModel);

    it("granting: a failure after the LAST write (newsletter reactivation) leaves customer, events and subscribers exactly as before", async () => {
      const c = await customer("rb-grant@example.com");
      await customer("bystander@example.com"); // an unrelated customer, so the collections are not trivially empty
      const before = await all();
      // subscribeToNewsletter writes twice (upsert, then reactivate); the 2nd is the last write of the transaction.
      const writes = failAfterWrite(newsletterSubscriberRepository, "updateAtomic", 2);

      await expect(setMarketingConsent(c._id.toString(), { granted: true, source: "account" })).rejects.toThrow("injected failure");

      expect(writes.calls).toBe(2); // the customer update, the event and the subscriber upsert had all really been written
      expect(await all()).toEqual(before);
      expect((await getProfile(c._id.toString())).marketingConsent).toEqual({ granted: false });
    });

    it("withdrawing: a failure after the newsletter unsubscribe leaves the consent, the event history and the subscription as they were", async () => {
      const c = await customer("rb-withdraw@example.com");
      const id = c._id.toString();
      await setMarketingConsent(id, { granted: true, source: "account" });
      const before = await all();
      const unsubscribe = failAfterWrite(NewsletterSubscriberModel, "updateMany", 1); // the unsubscribe is the last write

      await expect(setMarketingConsent(id, { granted: false, source: "account" })).rejects.toThrow("injected failure");

      expect(unsubscribe.calls).toBe(1);
      expect(await all()).toEqual(before);
      expect((await getProfile(id)).marketingConsent.granted).toBe(true);
      expect(await NewsletterSubscriberModel.findOne({ email: "rb-withdraw@example.com" })).toMatchObject({ status: "SUBSCRIBED" });
    });
  });
});
