import { configureNextBackendToolkit } from "@kira-joo/backend-toolkit-next";
import { resolveStaffUser } from "./auth/resolve-staff-user";
import { connectToDatabase } from "./db/connect";
import { mongoIdempotencyStore } from "./idempotency/mongo-idempotency-store";
import { publishRevalidation } from "./revalidation/publish-revalidation";

import { STAFF_ACCESS_TOKEN_TTL_SECONDS, STAFF_SESSION_COOKIE } from "./auth/staff-auth.constants";


/**
 * Configures `@kira-joo/backend-toolkit-next` once, application-wide.
 *
 * This app's global `auth` audience is **staff** — the toolkit's
 * `AuthConfig` resolves exactly one audience per deployment. `/api/shop/**`
 * routes therefore declare `auth: false` and resolve a customer themselves
 * (`src/server/shop/shop-actor.ts`), against a wholly separate secret, never
 * this one.
 *
 * **`idempotency` is wired in as of Phase 4A.5.** No route declares
 * `idempotent: true` yet (Phase 4A.5 builds no routes), but the store itself
 * — `mongoIdempotencyStore`, backed by `IdempotencyRecordModel` — is real
 * infrastructure the moment Phase 4B's first money-moving route needs it,
 * not speculative: `IdempotencyRecordModel` already exists and is asserted
 * by `ensureIndexes()` regardless, so configuring this here rather than
 * later costs nothing and removes one thing Phase 4B has to remember to add.
 */
export function configureToolkit(): void {
  configureNextBackendToolkit({
    database: { connect: connectToDatabase },
    jwt: {
      secret: requireSecret("STAFF_JWT_SECRET"),
      defaultExpiresIn: STAFF_ACCESS_TOKEN_TTL_SECONDS,
    },
    auth: {
      resolveUser: resolveStaffUser,
      tokenSource: "cookie",
      cookieName: STAFF_SESSION_COOKIE,
    },
    cache: { publishRevalidation },
    idempotency: { store: mongoIdempotencyStore },
  });
}

/**
 * A missing or short secret throws at configure time (boot), not on the
 * first request that happens to need it — the same posture
 * `restaurant-platform-staff` takes, and the one the authentication
 * architecture doc requires ("a named secret with a boot-time ≥32-char
 * check that throws").
 */
function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters. Generate one with: openssl rand -base64 48`);
  }
  return value;
}
