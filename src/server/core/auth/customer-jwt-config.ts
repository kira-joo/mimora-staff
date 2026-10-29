import type { NextJwtConfig } from "@kira-joo/backend-toolkit-next";

/**
 * The customer JWT configuration — wholly independent from the staff one in
 * `toolkit.config.ts`. Two audiences never share a secret: sharing would
 * make a customer token verify against the staff surface, and the
 * separation would be decorative with a silent failure mode.
 *
 * Passed explicitly to `verifyAuthToken`/`signAuthToken` rather than through
 * `configureNextBackendToolkit`, because that global config resolves one
 * audience (staff) for the whole application — the shop surface manages its
 * own token verification entirely inside its route handlers.
 */
export function customerJwtConfig(): NextJwtConfig {
  return {
    secret: requireSecret("CUSTOMER_JWT_SECRET"),
    defaultExpiresIn: process.env.CUSTOMER_ACCESS_TOKEN_TTL ?? "15m",
  };
}

function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters. Generate one with: openssl rand -base64 48`);
  }
  return value;
}
