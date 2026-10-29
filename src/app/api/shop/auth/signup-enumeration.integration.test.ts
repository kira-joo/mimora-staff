import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";

// Session cookies are written through `next/headers`; record every write so "no cookie at signup" is asserted, not assumed.
const cookieWrites: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string) => void cookieWrites.push(name), get: () => undefined, delete: () => undefined }),
}));

import { connectToDatabase } from "src/server/core/db/connect";
import { CustomerModel } from "src/server/identity/customer.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { callShopRoute, type ShopRouteHandler } from "../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { POST: SIGNUP } = (await import("./signup/route")) as unknown as { POST: ShopRouteHandler };
const { POST: LOGIN } = (await import("./login/route")) as unknown as { POST: ShopRouteHandler };

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  cookieWrites.length = 0;
  process.env.STORE_PHONE_COUNTRY_CODE = "20";
  await Promise.all([CustomerModel.deleteMany({}), RateLimitModel.deleteMany({})]);
});
afterAll(async () => {
  delete process.env.STORE_PHONE_COUNTRY_CODE;
  await CustomerModel.deleteMany({});
  await mongoose.disconnect();
});

const EXISTING_PHONE = "+201005550001";
const EXISTING_EMAIL = "existing@example.com";
const signup = (body: Record<string, unknown>) =>
  callShopRoute(SIGNUP, "/api/shop/auth/signup", { method: "POST", body, headers: { "idempotency-key": crypto.randomUUID() } });
const login = (phone: string, password: string) => callShopRoute(LOGIN, "/api/shop/auth/login", { method: "POST", body: { phone, password } });

/** Everything an observer can see of a response. */
const observable = (r: { status: number; body: unknown; headers: Headers }) => ({
  status: r.status,
  body: JSON.stringify(r.body),
  headers: [...r.headers.entries()].sort(),
});

async function seedExisting() {
  await CustomerModel.create({ phone: EXISTING_PHONE, email: EXISTING_EMAIL, passwordHash: await hashPassword("victim-password"), name: "Victim" });
}

describe("POST /api/shop/auth/signup — no account-existence oracle", () => {
  it("answers byte-identically for a new phone, a registered phone and a registered email — 202, { status: accepted }, no Set-Cookie", async () => {
    await seedExisting();

    const fresh = await signup({ phone: "+201005550002", password: "fresh-password-1", name: "Fresh" });
    const takenPhone = await signup({ phone: EXISTING_PHONE, password: "attacker-password", name: "Attacker" });
    const takenEmail = await signup({ phone: "+201005550003", email: EXISTING_EMAIL, password: "attacker-password", name: "Attacker" });

    expect(fresh.status).toBe(202);
    expect(fresh.body).toEqual({ status: "accepted" });
    expect(fresh.headers.get("set-cookie")).toBeNull();
    expect(observable(takenPhone)).toEqual(observable(fresh));
    expect(observable(takenEmail)).toEqual(observable(fresh));
    expect(cookieWrites).toEqual([]);
  });

  it("creates an account only in the new case; the existing account's password and name are unchanged", async () => {
    await seedExisting();
    const before = await CustomerModel.findOne({ phone: EXISTING_PHONE }).select("+passwordHash");

    await signup({ phone: EXISTING_PHONE, password: "attacker-password", name: "Attacker" });
    await signup({ phone: "+201005550003", email: EXISTING_EMAIL, password: "attacker-password", name: "Attacker" });
    expect(await CustomerModel.countDocuments({})).toBe(1);
    const after = await CustomerModel.findOne({ phone: EXISTING_PHONE }).select("+passwordHash");
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.name).toBe("Victim");

    await signup({ phone: "+201005550002", password: "fresh-password-1", name: "Fresh" });
    expect(await CustomerModel.countDocuments({})).toBe(2);
  });

  it("the new customer can then sign in; the attacker's password does not open the pre-existing account", async () => {
    await seedExisting();
    await signup({ phone: "+201005550002", password: "fresh-password-1", name: "Fresh" });
    await signup({ phone: EXISTING_PHONE, password: "attacker-password", name: "Attacker" });

    const ok = await login("+201005550002", "fresh-password-1");
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe("Fresh");
    expect(cookieWrites.length).toBeGreaterThan(0);

    const attacker = await login(EXISTING_PHONE, "attacker-password");
    const unknown = await login("+201005559999", "attacker-password");
    expect(attacker.status).toBe(401);
    expect(attacker.body.message ?? attacker.body.error).toMatch(/Invalid phone number or password/);
    expect(observable(attacker)).toEqual(observable(unknown));
    expect((await login(EXISTING_PHONE, "victim-password")).status).toBe(200);
  });

  it("still returns 400 for malformed input — which depends only on the input, never on existence", async () => {
    expect((await signup({ phone: "not-a-phone", password: "fresh-password-1", name: "X" })).status).toBe(400);
    expect((await signup({ phone: "+201005550002", password: "short", name: "X" })).status).toBe(400);
    expect((await signup({ phone: "+201005550002", password: "fresh-password-1", name: "" })).status).toBe(400);
  });
});
