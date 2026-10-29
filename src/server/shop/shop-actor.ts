import { UnauthorizedError } from "@kira-joo/backend-toolkit-core";
import { extractAuthToken } from "@kira-joo/backend-toolkit-next";
import { randomBytes } from "node:crypto";
import { resolveCustomerFromAccessToken, type CustomerIdentity } from "../core/auth/resolve-customer";
import { CUSTOMER_SESSION_COOKIE } from "../core/auth/customer-session-cookies";

export const CART_TOKEN_HEADER = "x-cart-token";

export type ShopActor = { kind: "customer"; customer: CustomerIdentity } | { kind: "guest"; cartToken: string | null };

/**
 * Resolves who is making a `/api/shop/**` request — a signed-in customer or
 * a legitimate guest.
 *
 * Every `/api/shop/**` route declares `auth: false` at the factory level and
 * calls this (or `requireCustomer`) itself, because `configureNextBackendToolkit`'s
 * global `auth` resolves exactly one audience per deployment, and here that
 * audience is staff. Reusing it for a shop request would authenticate a
 * customer against `staffusers` — the exact cross-audience failure this
 * separation exists to prevent.
 *
 * **Reads the `store_customer_session` HttpOnly cookie, not an
 * `Authorization` header — this is the Phase 4B Shop Authentication batch's
 * one directly-necessitated change to this file.** The prior version read a
 * Bearer token, which implies a client holds and attaches the token itself
 * — exactly what this workspace's own authentication non-negotiable
 * prohibits ("frontend JavaScript never reads, stores, refreshes, or
 * attaches a token") and what `customer-session-cookies.ts` exists to
 * avoid. `extractAuthToken(request, {source: "cookie", cookieName})` is the
 * toolkit's own sanctioned mechanism for this — `authenticate-request.ts`'s
 * unauthenticated internals confirm cookie-sourced tokens are a first-class
 * path, not a workaround.
 *
 * **No CORS wrapper here, unlike the restaurant precedent's customer
 * surface.** D-1 decided against it for this app: shop traffic arrives
 * server-to-server from the storefront's own route handlers, never directly
 * from a browser, so there is no cross-origin request to police.
 *
 * **A present-but-invalid token is an error, never a silent downgrade to
 * guest.** `resolveCustomerFromAccessToken` is awaited directly, not
 * try/caught — an expired or tampered token throws and the caller sees a
 * 401, rather than being handed a fresh empty cart that reads as a
 * storefront bug rather than a session expiry.
 */
export async function resolveShopActor(request: Request): Promise<ShopActor> {
  const token = extractAuthToken(request, { source: "cookie", cookieName: CUSTOMER_SESSION_COOKIE });

  if (token) {
    return { kind: "customer", customer: await resolveCustomerFromAccessToken(token) };
  }

  return { kind: "guest", cartToken: request.headers.get(CART_TOKEN_HEADER) };
}

/** For routes where a guest is not a legitimate actor — an account is required. */
export async function requireCustomer(request: Request): Promise<CustomerIdentity> {
  const actor = await resolveShopActor(request);
  if (actor.kind !== "customer") {
    throw new UnauthorizedError("Sign in to continue.");
  }
  return actor.customer;
}

/** A fresh, unguessable guest cart identity. */
export function mintCartToken(): string {
  return randomBytes(32).toString("base64url");
}
