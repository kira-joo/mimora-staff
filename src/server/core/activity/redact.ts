/**
 * Redaction for the audit log's `changes` (the request body of an audited
 * mutation): a secret must never be stored there, and nothing else may be
 * hidden — an audit entry that hides what changed fails at its one job.
 *
 * Matched by WORD, not by substring. The previous substring rule
 * (`/password|token|secret|hash|otp|pin/i`) redacted `shippingFeeMode` and
 * `flatShippingFee` ("shi-PIN-g") and the theme's `tokenOverrides` — brand
 * colours the storefront serves publicly (`GET /api/storefront/theme`).
 *
 * A key is split into words (camelCase, snake_case, kebab-case). It is
 * sensitive when:
 * - any word is a secret on its own: password, secret, hash, otp, pin
 *   (so `passwordResetTokenHash`, `clientSecret`, `pinCode` stay redacted);
 * - or its LAST word is `token`/`tokens` — the noun the name is about
 *   (`token`, `accessToken`, `refresh_token`). As a leading word "token"
 *   qualifies something else and is not itself a credential:
 *   `tokenOverrides` (design tokens), `tokenVersion` (a counter).
 */
export const REDACTED = "[redacted]";

const SECRET_WORDS = new Set(["password", "passwords", "secret", "secrets", "hash", "otp", "pin"]);
const CREDENTIAL_NOUNS = new Set(["token", "tokens"]);

/** `passwordResetTokenHash` → ["password", "reset", "token", "hash"]; `x-api_TOKEN` → ["x", "api", "token"]. */
export function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function isSensitiveKey(key: string): boolean {
  const words = keyWords(key);
  if (words.some((word) => SECRET_WORDS.has(word))) return true;
  const last = words[words.length - 1];
  return last !== undefined && CREDENTIAL_NOUNS.has(last);
}

/** A copy of `value` with every sensitive key's value replaced, at any depth (up to 5 levels), arrays included. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => (isSensitiveKey(key) ? [key, REDACTED] : [key, redact(entryValue, depth + 1)]))
  );
}
