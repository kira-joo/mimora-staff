import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";

// The session cookies are written through `next/headers`, which has no request scope in a bare test process.
vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }) }));

import { connectToDatabase } from "src/server/core/db/connect";
import { CartModel } from "src/server/commerce/cart.schema";
import { CartLineModel, buildCartLineIdentityKey } from "src/server/commerce/cart-line.schema";
import { CustomerModel } from "src/server/identity/customer.schema";
import { RateLimitModel } from "src/server/core/rate-limit/rate-limit.schema";
import { cartRepository } from "src/server/core/repositories";
import { callShopRoute, type ShopRouteHandler } from "../test-support/shop-route-harness";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const { POST: LOGIN } = (await import("./login/route")) as unknown as { POST: ShopRouteHandler };
const { POST: SIGNUP } = (await import("./signup/route")) as unknown as { POST: ShopRouteHandler };

beforeAll(async () => {
  await connectToDatabase();
});
beforeEach(async () => {
  await Promise.all([CustomerModel.deleteMany({}), CartModel.deleteMany({}), CartLineModel.deleteMany({}), RateLimitModel.deleteMany({})]);
});
afterAll(async () => {
  await Promise.all([CustomerModel.deleteMany({}), CartModel.deleteMany({}), CartLineModel.deleteMany({})]);
  await mongoose.disconnect();
});

const PHONE = "+201005550001";
const TOKEN = "guest-token-auth";

async function guestCartWithLine() {
  const cart = await CartModel.create({ cartToken: TOKEN });
  const variantId = new mongoose.Types.ObjectId();
  await CartLineModel.create({ cartId: cart._id, variantId, quantity: 2, lineIdentityKey: buildCartLineIdentityKey(cart._id, variantId, undefined) });
  return cart;
}

describe("POST /api/shop/auth/login — cart merge", () => {
  beforeEach(async () => {
    await CustomerModel.create({ phone: PHONE, passwordHash: await hashPassword("correct-horse-battery"), name: "Lena" });
  });

  it("merges the guest cart and reports it, additively to the existing body", async () => {
    const cart = await guestCartWithLine();

    const { status, body } = await callShopRoute(LOGIN, "/api/shop/auth/login", { method: "POST", body: { phone: PHONE, password: "correct-horse-battery" }, headers: { "x-cart-token": TOKEN } });

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["_id", "cartMerge", "name", "phone"]);
    expect(body.cartMerge).toEqual({ merged: true, lineCount: 1 });
    expect((await CartModel.findById(cart._id).lean())?.customerId?.toString()).toBe(body._id);
  });

  it("without a cart token: cartMerge is { merged: false, lineCount: 0 }", async () => {
    const { status, body } = await callShopRoute(LOGIN, "/api/shop/auth/login", { method: "POST", body: { phone: PHONE, password: "correct-horse-battery" } });
    expect(status).toBe(200);
    expect(body.cartMerge).toEqual({ merged: false, lineCount: 0 });
  });

  it("a merge failure does NOT fail the sign-in: 200, not merged, guest cart intact", async () => {
    const cart = await guestCartWithLine();
    await CartModel.create({ customerId: (await CustomerModel.findOne({ phone: PHONE }))!._id });
    vi.spyOn(cartRepository, "delete").mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { status, body } = await callShopRoute(LOGIN, "/api/shop/auth/login", { method: "POST", body: { phone: PHONE, password: "correct-horse-battery" }, headers: { "x-cart-token": TOKEN } });

    expect(status).toBe(200);
    expect(body.cartMerge).toEqual({ merged: false, lineCount: 0 });
    expect((await CartModel.findById(cart._id).lean())?.cartToken).toBe(TOKEN);
    vi.restoreAllMocks();
  });

  it("a wrong password merges nothing", async () => {
    const cart = await guestCartWithLine();
    const { status } = await callShopRoute(LOGIN, "/api/shop/auth/login", { method: "POST", body: { phone: PHONE, password: "wrong-password-1" }, headers: { "x-cart-token": TOKEN } });
    expect(status).toBe(401);
    expect((await CartModel.findById(cart._id).lean())?.cartToken).toBe(TOKEN);
  });
});

describe("POST /api/shop/auth/signup — cart", () => {
  it("leaves the guest cart untouched (no session exists to merge into); the merge happens at login", async () => {
    const cart = await guestCartWithLine();

    const { status, body } = await callShopRoute(SIGNUP, "/api/shop/auth/signup", {
      method: "POST",
      body: { phone: "+201005550002", password: "correct-horse-battery", name: "New" },
      headers: { "x-cart-token": TOKEN, "Idempotency-Key": `s-${new mongoose.Types.ObjectId()}` },
    });

    expect(status).toBe(202);
    expect(body).toEqual({ status: "accepted" });
    const after = await CartModel.findById(cart._id).lean();
    expect(after?.cartToken).toBe(TOKEN);
    expect(after?.customerId).toBeUndefined();

    const login = await callShopRoute(LOGIN, "/api/shop/auth/login", { method: "POST", body: { phone: "+201005550002", password: "correct-horse-battery" }, headers: { "x-cart-token": TOKEN } });
    expect(login.body.cartMerge).toEqual({ merged: true, lineCount: 1 });
    expect((await CartModel.findById(cart._id).lean())?.customerId?.toString()).toBe(login.body._id);
  });
});
