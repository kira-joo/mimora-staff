import { NextRequest } from "next/server";
import { signAuthToken } from "@kira-joo/backend-toolkit-next";
import { customerJwtConfig } from "src/server/core/auth/customer-jwt-config";
import { CUSTOMER_SESSION_COOKIE } from "src/server/core/auth/customer-session-cookies";

/**
 * Calls `/api/shop/**` route handlers the way Next does — real DTO validation,
 * real actor resolution, real serialization, no HTTP server. The caller must
 * set `CUSTOMER_JWT_SECRET` and `STAFF_JWT_SECRET` before dynamically importing
 * a route module (importing one configures the whole toolkit).
 */
export type ShopRouteHandler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface ShopCallInit {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  /** Signs a session cookie for this customer id (tokenVersion 1). */
  customerId?: string;
}

export async function customerCookie(customerId: string): Promise<string> {
  const token = await signAuthToken({ sub: customerId, tokenVersion: 1 }, undefined, customerJwtConfig());
  return `${CUSTOMER_SESSION_COOKIE}=${token}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the body is arbitrary parsed JSON from the route under test; every caller indexes into it freely, and `unknown` would force a cast at each of those assertions.
export async function callShopRoute(handler: ShopRouteHandler, path: string, init: ShopCallInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
  if (init.customerId) headers.cookie = await customerCookie(init.customerId);

  const response = await handler(
    new NextRequest(`http://localhost${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { params: Promise.resolve(init.params ?? {}) }
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined, headers: response.headers };
}
