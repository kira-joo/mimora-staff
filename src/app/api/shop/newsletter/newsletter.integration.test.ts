import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@kira-joo/backend-toolkit-next";

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }),
}));

import { connectToDatabase } from "src/server/core/db/connect";
import { CustomerModel } from "src/server/identity/customer.schema";
import { NewsletterSubscriberModel } from "src/server/newsletter/newsletter-subscriber.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { RATE_LIMITS } from "src/server/core/rate-limit/enforce-rate-limit";
import { callShopRoute, type ShopRouteHandler } from "../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { POST } = (await import("./route")) as unknown as { POST: ShopRouteHandler };
const { PUT: CONSENT } = (await import("../profile/marketing-consent/route")) as unknown as { PUT: ShopRouteHandler };

let ipCounter = 0;
const subscribe = (body: Record<string, unknown>, init: { ip?: string; customerId?: string } = {}) =>
  callShopRoute(POST, "/api/shop/newsletter", { method: "POST", body, customerId: init.customerId, headers: { "x-forwarded-for": init.ip ?? `10.30.0.${++ipCounter}` } });

/** Everything an observer can see of a response. */
const observable = (r: { status: number; body: unknown; headers: Headers }) => ({ status: r.status, body: JSON.stringify(r.body), headers: [...r.headers.entries()].sort() });

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  await Promise.all([NewsletterSubscriberModel.deleteMany({}), RateLimitModel.deleteMany({}), CustomerModel.deleteMany({})]);
});
afterAll(async () => {
  await Promise.all([NewsletterSubscriberModel.deleteMany({}), RateLimitModel.deleteMany({}), CustomerModel.deleteMany({})]);
  await mongoose.disconnect();
});

describe("POST /api/shop/newsletter", () => {
  // These tests run with no mail configured, so a public subscription stays PENDING (double opt-in needs an email to
  // carry the link). The configured path is `double-opt-in.integration.test.ts`.
  it("stores a normalised PENDING subscriber with locale and source, and NO consent timestamp until it is confirmed", async () => {
    const response = await subscribe({ email: "  Mona@Example.COM ", locale: "en", source: "footer" });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: "accepted" });
    const row = await NewsletterSubscriberModel.findOne({}).lean();
    expect(row).toMatchObject({ email: "mona@example.com", locale: "en", source: "footer", status: "PENDING" });
    expect(row?.consentedAt).toBeUndefined();
  });

  it("defaults to the footer source and the default locale", async () => {
    await subscribe({ email: "d@example.com" });
    expect(await NewsletterSubscriberModel.findOne({}).lean()).toMatchObject({ source: "footer", locale: "ar" });
  });

  it("is idempotent per address (any case) and never moves the first source", async () => {
    await subscribe({ email: "once@example.com", source: "footer" });
    await subscribe({ email: "ONCE@example.com", source: "checkout", locale: "en" });
    expect(await NewsletterSubscriberModel.countDocuments({})).toBe(1);
    expect(await NewsletterSubscriberModel.findOne({}).lean()).toMatchObject({ source: "footer", status: "PENDING" });
  });

  it("never moves the consent timestamp of an address that is already subscribed", async () => {
    const consentedAt = new Date("2026-01-01T00:00:00Z");
    await NewsletterSubscriberModel.create({ email: "there@example.com", source: "footer", status: "SUBSCRIBED", consentedAt });
    await subscribe({ email: "THERE@example.com", source: "checkout" });
    expect(await NewsletterSubscriberModel.findOne({}).lean()).toMatchObject({ status: "SUBSCRIBED", consentedAt });
  });

  it("answers byte-identically for a new, an already-subscribed and a previously unsubscribed address — no enumeration", async () => {
    await NewsletterSubscriberModel.create({ email: "gone@example.com", source: "footer", status: "UNSUBSCRIBED", consentedAt: new Date(), unsubscribedAt: new Date() });
    await subscribe({ email: "there@example.com" });
    const fresh = await subscribe({ email: "fresh@example.com" });
    const repeat = await subscribe({ email: "there@example.com" });
    const unsubscribed = await subscribe({ email: "gone@example.com" });
    expect(observable(repeat)).toEqual(observable(fresh));
    expect(observable(unsubscribed)).toEqual(observable(fresh));
  });

  it("a public request never re-subscribes an address that was unsubscribed", async () => {
    await NewsletterSubscriberModel.create({ email: "gone@example.com", source: "footer", status: "UNSUBSCRIBED", consentedAt: new Date(), unsubscribedAt: new Date() });
    await subscribe({ email: "gone@example.com" });
    expect((await NewsletterSubscriberModel.findOne({}).lean())?.status).toBe("UNSUBSCRIBED");
  });

  it("rejects malformed input with 400 and stores nothing; a caller cannot claim a server-only source", async () => {
    expect((await subscribe({ email: "not-an-email" })).status).toBe(400);
    expect((await subscribe({})).status).toBe(400);
    expect((await subscribe({ email: "x@example.com", source: "signup" })).status).toBe(400);
    expect((await subscribe({ email: "x@example.com", locale: "fr" })).status).toBe(400);
    expect(await NewsletterSubscriberModel.countDocuments({})).toBe(0);
  });

  it("is rate limited per client address: the eleventh request from one IP is 429", async () => {
    const ip = "198.51.100.90";
    const statuses: number[] = [];
    for (let i = 0; i <= RATE_LIMITS.NEWSLETTER_SUBSCRIBE.maxAttempts; i += 1) statuses.push((await subscribe({ email: `u${i}@example.com` }, { ip })).status);
    expect(statuses.slice(0, 10).every((status) => status === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("a signed-in customer subscribing their own email gives consent on the account; a different address is list-only", async () => {
    const own = await CustomerModel.create({ phone: "+201005550301", email: "own@example.com", passwordHash: await hashPassword("password-1234"), name: "Own" });
    await subscribe({ email: "own@example.com" }, { customerId: own._id.toString() });
    expect((await CustomerModel.findById(own._id).lean())?.marketingConsent).toMatchObject({ granted: true, source: "newsletter" });

    await subscribe({ email: "other@example.com" }, { customerId: own._id.toString() });
    expect(await NewsletterSubscriberModel.findOne({ email: "other@example.com" })).toMatchObject({ status: "PENDING" });
    expect((await NewsletterSubscriberModel.findOne({ email: "other@example.com" }).lean())?.customerId).toBeUndefined();
  });
});

describe("PUT /api/shop/profile/marketing-consent", () => {
  it("requires a signed-in customer", async () => {
    const response = await callShopRoute(CONSENT, "/api/shop/profile/marketing-consent", { method: "PUT", body: { granted: true } });
    expect(response.status).toBe(401);
  });

  it("grants and withdraws for the signed-in customer, and only for them", async () => {
    const me = await CustomerModel.create({ phone: "+201005550302", email: "me@example.com", passwordHash: await hashPassword("password-1234"), name: "Me" });
    const other = await CustomerModel.create({ phone: "+201005550303", passwordHash: await hashPassword("password-1234"), name: "Other" });
    const granted = await callShopRoute(CONSENT, "/api/shop/profile/marketing-consent", { method: "PUT", body: { granted: true, source: "checkout" }, customerId: me._id.toString() });
    expect(granted.body).toMatchObject({ granted: true, source: "checkout" });
    const withdrawn = await callShopRoute(CONSENT, "/api/shop/profile/marketing-consent", { method: "PUT", body: { granted: false }, customerId: me._id.toString() });
    expect(withdrawn.body).toMatchObject({ granted: false, source: "account" });
    expect((await CustomerModel.findById(other._id).lean())?.marketingConsent).toBeUndefined();
    expect((await callShopRoute(CONSENT, "/api/shop/profile/marketing-consent", { method: "PUT", body: { granted: true, source: "signup" }, customerId: me._id.toString() })).status).toBe(400);
  });
});
