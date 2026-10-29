// @vitest-environment node
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { CUSTOMER_SESSION_COOKIE } from "../core/auth/customer-session-cookies";
import { customerJwtConfig } from "../core/auth/customer-jwt-config";
import { CustomerModel } from "../identity/customer.schema";
import { CART_TOKEN_HEADER, mintCartToken, requireCustomer, resolveShopActor } from "./shop-actor";

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

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/shop/cart", { headers });
}

/**
 * `Phase 4B Shop Authentication batch`: `resolveShopActor` reads the
 * `store_customer_session` cookie now, not an `Authorization` header — see
 * `shop-actor.ts`'s own doc comment for why (the prior Bearer-token design
 * implied a client attaches the token itself, contradicting this
 * workspace's own HttpOnly-cookie non-negotiable). These tests construct a
 * raw `Cookie` header directly rather than going through a real
 * `NextRequest`/`next/headers` cookie jar — `readTokenCookie`'s own
 * documented fallback path (`parseCookieHeader` on a plain `Request`'s
 * `Cookie` header) is exactly what makes this a faithful, real exercise of
 * the same code path a real request takes.
 */
function cookieHeader(token: string): Record<string, string> {
  return { cookie: `${CUSTOMER_SESSION_COOKIE}=${token}` };
}

describe("resolveShopActor", () => {
  it("resolves a guest with a cart token", async () => {
    const cartToken = mintCartToken();
    const actor = await resolveShopActor(requestWith({ [CART_TOKEN_HEADER]: cartToken }));
    expect(actor).toEqual({ kind: "guest", cartToken });
  });

  it("resolves a guest with no cart token at all — the first-ever visit", async () => {
    const actor = await resolveShopActor(requestWith({}));
    expect(actor).toEqual({ kind: "guest", cartToken: null });
  });

  it("resolves a signed-in customer from a valid session cookie", async () => {
    const customer = await CustomerModel.create({
      phone: `+2010${Math.floor(Math.random() * 100000000)}`,
      passwordHash: "x",
      name: "Test Customer",
      tokenVersion: 1,
    });
    const token = await signAuthToken({ sub: customer._id.toString(), tokenVersion: 1 }, undefined, customerJwtConfig());

    const actor = await resolveShopActor(requestWith(cookieHeader(token)));
    expect(actor.kind).toBe("customer");
    if (actor.kind === "customer") expect(actor.customer._id).toBe(customer._id.toString());
  });

  it("a present-but-invalid token is an error, never a silent downgrade to guest", async () => {
    // The whole reason this function is not a try/catch around token
    // verification — see its own doc comment.
    await expect(resolveShopActor(requestWith(cookieHeader("garbage")))).rejects.toThrow();
  });

  it("a session cookie takes priority over a cart token if both are somehow present", async () => {
    const customer = await CustomerModel.create({
      phone: `+2010${Math.floor(Math.random() * 100000000)}`,
      passwordHash: "x",
      name: "Test Customer",
      tokenVersion: 1,
    });
    const token = await signAuthToken({ sub: customer._id.toString(), tokenVersion: 1 }, undefined, customerJwtConfig());

    const actor = await resolveShopActor(
      requestWith({ ...cookieHeader(token), [CART_TOKEN_HEADER]: mintCartToken() })
    );
    expect(actor.kind).toBe("customer");
  });
});

describe("requireCustomer", () => {
  it("returns the customer when one is resolved", async () => {
    const customer = await CustomerModel.create({
      phone: `+2010${Math.floor(Math.random() * 100000000)}`,
      passwordHash: "x",
      name: "Test Customer",
      tokenVersion: 1,
    });
    const token = await signAuthToken({ sub: customer._id.toString(), tokenVersion: 1 }, undefined, customerJwtConfig());

    const identity = await requireCustomer(requestWith(cookieHeader(token)));
    expect(identity._id).toBe(customer._id.toString());
  });

  it("refuses a guest", async () => {
    await expect(requireCustomer(requestWith({}))).rejects.toThrow(/Sign in/);
  });

  it("refuses an invalid token rather than treating it as a guest", async () => {
    await expect(requireCustomer(requestWith(cookieHeader("garbage")))).rejects.toThrow();
  });
});

describe("mintCartToken", () => {
  it("produces distinct, non-trivial tokens", () => {
    const a = mintCartToken();
    const b = mintCartToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});
