import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@kira-joo/backend-toolkit-next";

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }),
}));

import { connectToDatabase } from "src/server/core/db/connect";
import { outboundNotifier } from "src/server/core/notifications";
import { IdempotencyRecordModel } from "src/server/commerce/idempotency-record.schema";
import { CustomerModel } from "src/server/identity/customer.schema";
import { NEWSLETTER_CONFIRMATION_TTL_MS, NEWSLETTER_RESEND_AFTER_MS } from "src/server/newsletter/confirmation.constants";
import { NewsletterSubscriberModel } from "src/server/newsletter/newsletter-subscriber.schema";
import { settleBackgroundWork } from "src/server/notifications/after-response";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { callShopRoute, type ShopRouteHandler } from "../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { POST: SUBSCRIBE } = (await import("./route")) as unknown as { POST: ShopRouteHandler };
const { POST: CONFIRM } = (await import("./confirm/route")) as unknown as { POST: ShopRouteHandler };
const { PUT: CONSENT } = (await import("../profile/marketing-consent/route")) as unknown as { PUT: ShopRouteHandler };

const MAIL_ENV = { SMTP_HOST: "smtp.test.example", SMTP_PORT: "587", MAIL_FROM: "Shop <orders@shop.test>", STOREFRONT_URL: "https://shop.test", BACKOFFICE_URL: "https://console.shop.test" };
const MAIL_NAMES = [...Object.keys(MAIL_ENV), "SMTP_USER", "SMTP_PASS", "SMTP_SECURE", "MAIL_REPLY_TO"];
const originalEnv = Object.fromEntries(MAIL_NAMES.map((name) => [name, process.env[name]]));

const mailOn = () => Object.assign(process.env, MAIL_ENV);
const mailOff = () => {
  for (const name of MAIL_NAMES) delete process.env[name];
};

const sendSpy = vi.spyOn(outboundNotifier, "send");
let ipCounter = 0;
let keyCounter = 0;
const subscribe = (body: Record<string, unknown>) => callShopRoute(SUBSCRIBE, "/api/shop/newsletter", { method: "POST", body, headers: { "x-forwarded-for": `10.77.0.${++ipCounter}` } });
const confirm = (token: string) => callShopRoute(CONFIRM, "/api/shop/newsletter/confirm", { method: "POST", body: { token }, headers: { "Idempotency-Key": `confirm-${++keyCounter}-${Date.now()}` } });
const observable = (r: { status: number; body: unknown; headers: Headers }) => ({ status: r.status, body: JSON.stringify(r.body), headers: [...r.headers.entries()].sort() });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const stored = (email: string) => NewsletterSubscriberModel.findOne({ email }).select("+confirmationTokenHash").lean();

/** The plaintext token, read back out of the one email that was sent — the only place it exists. */
function tokenFromEmail(call = sendSpy.mock.calls.at(-1)!): string {
  const message = call[0];
  const match = /\/newsletter\/confirm\?token=([A-Za-z0-9_-]+)/.exec(message.body);
  expect(match, "the email carries a confirmation link").not.toBeNull();
  return match![1]!;
}

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  sendSpy.mockReset();
  sendSpy.mockResolvedValue(undefined);
  mailOn();
  await Promise.all([NewsletterSubscriberModel.deleteMany({}), RateLimitModel.deleteMany({}), CustomerModel.deleteMany({}), IdempotencyRecordModel.deleteMany({})]);
});
afterEach(async () => {
  await settleBackgroundWork();
  for (const name of MAIL_NAMES) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});
afterAll(async () => {
  await Promise.all([NewsletterSubscriberModel.deleteMany({}), RateLimitModel.deleteMany({}), CustomerModel.deleteMany({}), IdempotencyRecordModel.deleteMany({})]);
  await mongoose.disconnect();
});

describe("double opt-in — mail configured", () => {
  it("a public subscribe creates a PENDING row, stores only the token's hash with a 48h expiry, and emails the link", async () => {
    const response = await subscribe({ email: "Mona@Example.com", locale: "en" });
    expect(response).toMatchObject({ status: 202, body: { status: "accepted" } });
    await settleBackgroundWork();

    const row = await stored("mona@example.com");
    expect(row).toMatchObject({ status: "PENDING" });
    expect(row?.consentedAt).toBeUndefined();
    expect(row?.confirmedAt).toBeUndefined();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const message = sendSpy.mock.calls[0]![0];
    expect(message).toMatchObject({ channel: "EMAIL", to: "mona@example.com", template: "newsletter-confirm" });
    const token = tokenFromEmail();
    expect(message.body).toContain(`https://shop.test/en/newsletter/confirm?token=${token}`);
    expect(message.subject).not.toContain(token);

    expect(row?.confirmationTokenHash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token); // the plaintext is nowhere in the stored document
    const lifetime = row!.confirmationExpiresAt!.getTime() - row!.confirmationSentAt!.getTime();
    expect(lifetime).toBe(NEWSLETTER_CONFIRMATION_TTL_MS);
  });

  it("the Arabic subscriber gets an Arabic, right-to-left email", async () => {
    await subscribe({ email: "ar@example.com", locale: "ar" });
    await settleBackgroundWork();
    const message = sendSpy.mock.calls[0]![0];
    expect(message.html).toContain('dir="rtl"');
    expect(message.body).toContain("https://shop.test/ar/newsletter/confirm?token=");
  });

  it("confirming with the emailed token subscribes, stamps consent and confirmation, and clears every token field", async () => {
    await subscribe({ email: "ok@example.com" });
    await settleBackgroundWork();
    const token = tokenFromEmail();

    const response = await confirm(token);
    expect(response.status).toBe(204);

    const row = await stored("ok@example.com");
    expect(row).toMatchObject({ status: "SUBSCRIBED" });
    expect(row?.consentedAt).toBeInstanceOf(Date);
    expect(row?.confirmedAt).toBeInstanceOf(Date);
    expect(row?.confirmationTokenHash).toBeUndefined();
    expect(row?.confirmationExpiresAt).toBeUndefined();
  });

  it("NEGATIVE: the token is single-use — a second confirmation with a fresh idempotency key is refused", async () => {
    await subscribe({ email: "once@example.com" });
    await settleBackgroundWork();
    const token = tokenFromEmail();
    expect((await confirm(token)).status).toBe(204);
    expect((await confirm(token)).status).toBe(401);
  });

  it("NEGATIVE: an expired token, a wrong token and an empty token are refused, and the address stays PENDING", async () => {
    await subscribe({ email: "late@example.com" });
    await settleBackgroundWork();
    const token = tokenFromEmail();
    await NewsletterSubscriberModel.updateOne({ email: "late@example.com" }, { $set: { confirmationExpiresAt: new Date(Date.now() - 1000) } });

    expect((await confirm(token)).status).toBe(401);
    expect((await confirm("not-the-token")).status).toBe(401);
    expect((await confirm("")).status).toBe(400);
    expect(await stored("late@example.com")).toMatchObject({ status: "PENDING" });
  });

  it("NEGATIVE: a link for an address that has since unsubscribed cannot re-subscribe it", async () => {
    await subscribe({ email: "changed@example.com" });
    await settleBackgroundWork();
    const token = tokenFromEmail();
    await NewsletterSubscriberModel.updateOne({ email: "changed@example.com" }, { $set: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() } });
    expect((await confirm(token)).status).toBe(401);
    expect(await stored("changed@example.com")).toMatchObject({ status: "UNSUBSCRIBED" });
  });

  it("a replayed confirmation (same Idempotency-Key) answers from the stored response", async () => {
    await subscribe({ email: "replay@example.com" });
    await settleBackgroundWork();
    const token = tokenFromEmail();
    const headers = { "Idempotency-Key": "fixed-key-1" };
    const first = await callShopRoute(CONFIRM, "/api/shop/newsletter/confirm", { method: "POST", body: { token }, headers });
    const replay = await callShopRoute(CONFIRM, "/api/shop/newsletter/confirm", { method: "POST", body: { token }, headers });
    expect([first.status, replay.status]).toEqual([204, 204]);
  });

  it("is enumeration-safe: new, pending, subscribed and unsubscribed addresses all get the byte-identical answer", async () => {
    await NewsletterSubscriberModel.create({ email: "subbed@example.com", source: "footer", status: "SUBSCRIBED", consentedAt: new Date() });
    await NewsletterSubscriberModel.create({ email: "gone@example.com", source: "footer", status: "UNSUBSCRIBED", consentedAt: new Date(), unsubscribedAt: new Date() });
    const fresh = await subscribe({ email: "fresh@example.com" });
    const pending = await subscribe({ email: "fresh@example.com" });
    const subscribed = await subscribe({ email: "subbed@example.com" });
    const unsubscribed = await subscribe({ email: "gone@example.com" });
    for (const other of [pending, subscribed, unsubscribed]) expect(observable(other)).toEqual(observable(fresh));
  });

  it("sends nothing to an address that is already subscribed or has unsubscribed, and never issues them a token", async () => {
    await NewsletterSubscriberModel.create({ email: "subbed@example.com", source: "footer", status: "SUBSCRIBED", consentedAt: new Date() });
    await NewsletterSubscriberModel.create({ email: "gone@example.com", source: "footer", status: "UNSUBSCRIBED", consentedAt: new Date(), unsubscribedAt: new Date() });
    await subscribe({ email: "subbed@example.com" });
    await subscribe({ email: "gone@example.com" });
    await settleBackgroundWork();
    expect(sendSpy).not.toHaveBeenCalled();
    expect((await stored("subbed@example.com"))?.confirmationTokenHash).toBeUndefined();
    expect(await stored("gone@example.com")).toMatchObject({ status: "UNSUBSCRIBED" });
  });

  it("a pending address asking again inside the throttle window is NOT re-mailed; after it, a fresh link replaces the old one", async () => {
    await subscribe({ email: "again@example.com" });
    await settleBackgroundWork();
    const first = tokenFromEmail();

    await subscribe({ email: "again@example.com" });
    await settleBackgroundWork();
    expect(sendSpy).toHaveBeenCalledTimes(1);

    await NewsletterSubscriberModel.updateOne({ email: "again@example.com" }, { $set: { confirmationSentAt: new Date(Date.now() - NEWSLETTER_RESEND_AFTER_MS - 1000) } });
    await subscribe({ email: "again@example.com" });
    await settleBackgroundWork();
    expect(sendSpy).toHaveBeenCalledTimes(2);
    const second = tokenFromEmail();
    expect(second).not.toBe(first);

    expect((await confirm(first)).status).toBe(401); // the superseded link is dead
    expect((await confirm(second)).status).toBe(204);
  });

  it("a failing mail transport never fails the request, and the address stays PENDING", async () => {
    sendSpy.mockRejectedValue(new Error("smtp down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await subscribe({ email: "down@example.com" });
    expect(response.status).toBe(202);
    await settleBackgroundWork();
    expect(await stored("down@example.com")).toMatchObject({ status: "PENDING" });
  });
});

describe("double opt-in — mail OFF", () => {
  it("the address stays PENDING with no token and no email, and the answer is the same", async () => {
    mailOn();
    const configured = await subscribe({ email: "probe@example.com" });
    await settleBackgroundWork();
    sendSpy.mockClear();

    mailOff();
    const off = await subscribe({ email: "off@example.com", locale: "en" });
    await settleBackgroundWork();

    expect(observable(off)).toEqual(observable(configured));
    const row = await stored("off@example.com");
    expect(row).toMatchObject({ status: "PENDING" });
    expect(row?.confirmationTokenHash).toBeUndefined();
    expect(row?.consentedAt).toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("half-configured mail is treated as OFF: nothing is sent", async () => {
    delete process.env.MAIL_FROM;
    await subscribe({ email: "half@example.com" });
    await settleBackgroundWork();
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await stored("half@example.com")).toMatchObject({ status: "PENDING" });
  });

  it("once mail is configured, the pending address's next request issues its link", async () => {
    mailOff();
    await subscribe({ email: "later@example.com" });
    mailOn();
    await subscribe({ email: "later@example.com" });
    await settleBackgroundWork();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect((await confirm(tokenFromEmail())).status).toBe(204);
  });
});

describe("pending is not consent", () => {
  it("a signed-in customer turning marketing consent on for their own address subscribes it directly, even if a pending row exists", async () => {
    const me = await CustomerModel.create({ phone: "+201005550777", email: "me@example.com", passwordHash: await hashPassword("password-1234"), name: "Me" });
    await subscribe({ email: "me@example.com" });
    await settleBackgroundWork();
    expect(await stored("me@example.com")).toMatchObject({ status: "PENDING" });

    const granted = await callShopRoute(CONSENT, "/api/shop/profile/marketing-consent", { method: "PUT", body: { granted: true }, customerId: me._id.toString() });
    expect(granted.status).toBe(200);
    const row = await stored("me@example.com");
    expect(row).toMatchObject({ status: "SUBSCRIBED" });
    expect(row?.consentedAt).toBeInstanceOf(Date);
    expect(row?.confirmationTokenHash).toBeUndefined();
  });

  it("withdrawing consent also kills a pending link for that address", async () => {
    const me = await CustomerModel.create({ phone: "+201005550778", email: "wd@example.com", passwordHash: await hashPassword("password-1234"), name: "Wd", marketingConsent: { granted: true, at: new Date(), source: "account" } });
    await subscribe({ email: "wd@example.com" });
    await settleBackgroundWork();
    const token = tokenFromEmail();
    await callShopRoute(CONSENT, "/api/shop/profile/marketing-consent", { method: "PUT", body: { granted: false }, customerId: me._id.toString() });
    expect(await stored("wd@example.com")).toMatchObject({ status: "UNSUBSCRIBED" });
    expect((await confirm(token)).status).toBe(401);
  });
});
