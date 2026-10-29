/**
 * A single numeric source for both the JWT's own expiry and the session
 * cookie's `maxAge` — passed explicitly to `signAuthToken({expiresIn: ...})`
 * rather than left to `customerJwtConfig()`'s string-configured default
 * (`"15m"`). Parsing that string back into seconds to keep the cookie's
 * `maxAge` in agreement would be real, unnecessary parsing work with a real
 * drift risk if the two ever disagreed; one shared number in seconds
 * removes the question entirely.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Customer refresh tokens live longer than a staff session — a customer
 * expects to stay signed in across visits the way any consumer storefront
 * behaves; a staff member's session risk profile is different. 30 days,
 * matching this workspace's own common convention for a consumer-facing
 * refresh lifetime.
 */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_MS / 1000;

/** How long a password-reset or email-verification token stays valid before it must be re-requested. */
export const VERIFICATION_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
