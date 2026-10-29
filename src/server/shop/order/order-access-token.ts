import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { customerJwtConfig } from "../../core/auth/customer-jwt-config";

/** Domain-separates this key from every other use of the customer secret. */
const HKDF_INFO = "order-access-token/v1";

/**
 * The capability a guest holds for their own order: `base64url(HMAC-SHA256(key,
 * orderId-hex))`, where `key` is HKDF-derived from `CUSTOMER_JWT_SECRET`.
 *
 * **Nothing is stored.** The token is recomputed from the order id and
 * compared, so a database disclosure hands out no access, and rotating the
 * secret revokes every outstanding guest token (an accepted trade-off: a guest
 * who loses access re-contacts the store).
 *
 * This module is the one place the derivation lives — the placement response
 * mints it and the order-access guard verifies it.
 */
export function deriveOrderAccessToken(orderId: string): string {
  const key = Buffer.from(hkdfSync("sha256", customerJwtConfig().secret, Buffer.alloc(0), HKDF_INFO, 32));
  return createHmac("sha256", key).update(orderId.toString()).digest("base64url");
}

/** Constant-time compare that is also safe for a presented value of the wrong length (which `timingSafeEqual` alone throws on). */
export function isValidOrderAccessToken(orderId: string, presented: string | null | undefined): boolean {
  if (!presented) return false;
  const expected = Buffer.from(deriveOrderAccessToken(orderId));
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
