import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }),
}));

import { connectToDatabase } from "src/server/core/db/connect";
import { CustomerModel } from "src/server/identity/customer.schema";
import { IdempotencyRecordModel } from "src/server/commerce/idempotency-record.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { RATE_LIMITS } from "src/server/core/rate-limit/enforce-rate-limit";
import { callShopRoute, type ShopRouteHandler } from "../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

// Each test here makes 9-20 sequential sign-in attempts, and every attempt runs a real bcrypt comparison (login hashes
// even for an unknown account, so timing cannot reveal existence). On a CI runner that is past vitest's 5 s default
// (two tests timed out there); a budget sized to the work, not a weaker assertion.
vi.setConfig({ testTimeout: 30_000 });

const { POST: LOGIN } = (await import("./login/route")) as unknown as { POST: ShopRouteHandler };
const { POST: FORGOT } = (await import("./forgot-password/route")) as unknown as { POST: ShopRouteHandler };
const { POST: RESEND } = (await import("./resend-verification/route")) as unknown as { POST: ShopRouteHandler };
const { POST: SIGNUP } = (await import("./signup/route")) as unknown as { POST: ShopRouteHandler };

/**
 * Every unauthenticated, abuse-prone customer route enforces BOTH a per-address and a
 * per-account limit (the pair staff login uses). The per-account limit must hold under
 * ROTATING addresses — that is the one a combined IP+account key silently lacks — and
 * the per-address limit must hold across many accounts.
 */
let ipCounter = 0;
const freshIp = () => `10.20.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
const asIp = (ip: string) => ({ "x-forwarded-for": ip });

const login = (phone: string, password = "wrong-password", ip = freshIp()) =>
  callShopRoute(LOGIN, "/api/shop/auth/login", { method: "POST", body: { phone, password }, headers: asIp(ip) });
const forgot = (identifier: string, ip = freshIp()) =>
  callShopRoute(FORGOT, "/api/shop/auth/forgot-password", { method: "POST", body: { identifier }, headers: { ...asIp(ip), "idempotency-key": crypto.randomUUID() } });
const resend = (email: string, ip = freshIp()) =>
  callShopRoute(RESEND, "/api/shop/auth/resend-verification", { method: "POST", body: { email }, headers: { ...asIp(ip), "idempotency-key": crypto.randomUUID() } });
const signup = (phone: string, ip = freshIp()) =>
  callShopRoute(SIGNUP, "/api/shop/auth/signup", { method: "POST", body: { phone, password: "fresh-password-1", name: "Rate" }, headers: { ...asIp(ip), "idempotency-key": crypto.randomUUID() } });

/** Fires `count` sequential requests and returns every status — sequential, so the Nth is the Nth. */
async function fire(count: number, send: (index: number) => Promise<{ status: number }>) {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) statuses.push((await send(i)).status);
  return statuses;
}

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  process.env.STORE_PHONE_COUNTRY_CODE = "20";
  await Promise.all([CustomerModel.deleteMany({}), RateLimitModel.deleteMany({}), IdempotencyRecordModel.deleteMany({})]);
});
afterAll(async () => {
  delete process.env.STORE_PHONE_COUNTRY_CODE;
  await Promise.all([CustomerModel.deleteMany({}), RateLimitModel.deleteMany({}), IdempotencyRecordModel.deleteMany({})]);
  await mongoose.disconnect();
});

describe("POST /api/shop/auth/login", () => {
  it("limits per ACCOUNT under rotating addresses: the ninth attempt on one phone is 429 however many IPs it comes from", async () => {
    const statuses = await fire(RATE_LIMITS.LOGIN.maxAttempts + 1, () => login("+201005550100"));
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(401));
    expect(statuses[8]).toBe(429);
  });

  it("counts every spelling of one phone as the same account", async () => {
    const spellings = ["+201005550101", "01005550101", "+20 100 555 0101", "0100-555-0101"];
    const statuses = await fire(9, (i) => login(spellings[i % spellings.length]!));
    expect(statuses[8]).toBe(429);
    expect(statuses.slice(0, 8).every((status) => status === 401)).toBe(true);
  });

  it("limits per ADDRESS across many accounts: one IP walking a list of phones is stopped", async () => {
    const ip = "198.51.100.77";
    const statuses = await fire(RATE_LIMITS.LOGIN_ADDRESS.maxAttempts + 1, (i) => login(`+2010055${String(60000 + i)}`, "wrong-password", ip));
    expect(statuses.slice(0, RATE_LIMITS.LOGIN_ADDRESS.maxAttempts).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  }, 60_000);

  it("a successful sign-in clears the account counter, so ordinary typos never accumulate toward a lockout", async () => {
    await CustomerModel.create({ phone: "+201005550102", passwordHash: await hashPassword("right-password"), name: "Ok" });
    expect(await fire(7, () => login("+201005550102"))).toEqual(Array(7).fill(401));
    expect((await login("+201005550102", "right-password")).status).toBe(200);
    expect(await fire(8, () => login("+201005550102"))).toEqual(Array(8).fill(401));
  });

  it("a 429 for a registered phone and for an unknown one read identically — the limit is not an existence oracle", async () => {
    await CustomerModel.create({ phone: "+201005550103", passwordHash: await hashPassword("right-password"), name: "Ok" });
    const known = await fire(9, () => login("+201005550103"));
    const unknown = await fire(9, () => login("+201005550104"));
    expect(known).toEqual(unknown);
  });
});

describe("POST /api/shop/auth/forgot-password", () => {
  it("limits per ACCOUNT under rotating addresses (phone)", async () => {
    const statuses = await fire(RATE_LIMITS.PASSWORD_RESET_REQUEST.maxAttempts + 1, () => forgot("+201005550110"));
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(204));
    expect(statuses[5]).toBe(429);
  });

  it("limits per ACCOUNT under rotating addresses (email, any letter case)", async () => {
    const statuses = await fire(6, (i) => forgot(i % 2 ? "Mona@Example.com" : " mona@example.com "));
    expect(statuses[5]).toBe(429);
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(204));
  });

  it("limits per ADDRESS across many identifiers", async () => {
    const ip = "198.51.100.78";
    const statuses = await fire(RATE_LIMITS.PASSWORD_RESET_REQUEST_ADDRESS.maxAttempts + 1, (i) => forgot(`user${i}@example.com`, ip));
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(204));
    expect(statuses[20]).toBe(429);
  });
});

describe("POST /api/shop/auth/resend-verification", () => {
  it("limits per ACCOUNT under rotating addresses", async () => {
    const statuses = await fire(RATE_LIMITS.VERIFICATION_RESEND.maxAttempts + 1, () => resend("verify@example.com"));
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(204));
    expect(statuses[5]).toBe(429);
  });

  it("limits per ADDRESS across many emails", async () => {
    const ip = "198.51.100.79";
    const statuses = await fire(RATE_LIMITS.VERIFICATION_RESEND_ADDRESS.maxAttempts + 1, (i) => resend(`user${i}@example.com`, ip));
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(204));
    expect(statuses[20]).toBe(429);
  });
});

describe("POST /api/shop/auth/signup", () => {
  it("limits per IDENTIFIER (phone) under rotating addresses", async () => {
    const statuses = await fire(RATE_LIMITS.SIGNUP_IDENTIFIER.maxAttempts + 1, () => signup("+201005550120"));
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(202));
    expect(statuses[5]).toBe(429);
  });

  it("limits per ADDRESS across many phones", async () => {
    const ip = "198.51.100.80";
    const statuses = await fire(RATE_LIMITS.SIGNUP.maxAttempts + 1, (i) => signup(`+2010055513${i}`, ip));
    expect(statuses.slice(0, 5)).toEqual(Array(5).fill(202));
    expect(statuses[5]).toBe(429);
  });
});

describe("the address limit trusts only the right-most forwarded entry", () => {
  it("rotating the client-controlled left side of x-forwarded-for does not escape the per-address limit", async () => {
    const statuses = await fire(RATE_LIMITS.SIGNUP.maxAttempts + 1, (i) =>
      callShopRoute(SIGNUP, "/api/shop/auth/signup", {
        method: "POST",
        body: { phone: `+2010055514${i}`, password: "fresh-password-1", name: "Spoof" },
        headers: { "x-forwarded-for": `${i + 1}.${i + 1}.${i + 1}.${i + 1}, 198.51.100.81`, "idempotency-key": crypto.randomUUID() },
      })
    );
    expect(statuses.at(-1)).toBe(429);
  });
});
