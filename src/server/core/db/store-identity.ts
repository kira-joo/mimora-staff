import type { Db } from "mongodb";

/**
 * The store-identity guard: one deployment serves one store, the code carries no store field, and two deployments
 * pointed at one database would silently merge two stores' customers, orders and stock. So the database says whose it
 * is — a single marker document, written once by an operator (`scripts/admin/adopt-store-identity.mjs`) — and every
 * backend boot checks it against `STORE_ID`.
 *
 * ## What it refuses, and why each is a refusal rather than a repair
 *
 *  - **`STORE_ID` missing or malformed** — the deployment cannot say which store it is.
 *  - **No marker** — an unmarked database is exactly what a misconfigured second deployment would be pointed at, and
 *    "adopt it if it is empty" would let that deployment claim a store's database that merely lost its marker. The
 *    marker is therefore never created here; only the adoption command writes it.
 *  - **A marker for a different store** — the whole point. Never overwritten.
 *
 * The error is deliberately NOT an `AppError`: the toolkit serialises an `AppError`'s message into the HTTP body, and this
 * guard runs on public routes. A plain `Error` reaches the caller as a generic 500 and the operator's log in full.
 *
 * ## Constants shared with the CLI
 *
 * `scripts/admin/store-identity-core.mjs` is plain JS (no TypeScript in production images) and repeats the collection
 * name, the `_id` and the slug pattern; `store-identity.integration.test.ts` pins them equal.
 */
export const STORE_IDENTITY_COLLECTION = "storeidentity";
export const STORE_IDENTITY_DOC_ID = "store-identity";
export const STORE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const STORE_ID_RULE = "1-40 lowercase letters, digits and hyphens, starting and ending with a letter or digit";

type Env = Record<string, string | undefined>;

export class StoreIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreIdentityError";
  }
}

/**
 * Enforced everywhere except the test runner without a `STORE_ID`: the integration suites use many throwaway,
 * unmarked databases, and a test that exercises the guard sets `STORE_ID` to switch it on.
 */
export function storeIdentityEnforced(env: Env, nodeEnv: string | undefined = env.NODE_ENV): boolean {
  return !(nodeEnv === "test" && !env.STORE_ID?.trim());
}

/** The configured store id, or the reason it is unusable. Never returns an unvalidated value. */
export function configuredStoreId(env: Env): string {
  const value = env.STORE_ID?.trim();
  if (!value) {
    throw new StoreIdentityError(
      'STORE_ID is not set. This deployment must say which store it serves — a short lowercase slug such as "hirfa" — and the storefront must be given the same value. See docs/configuration.md → Store identity.'
    );
  }
  if (!STORE_ID_PATTERN.test(value)) {
    throw new StoreIdentityError(`STORE_ID "${value}" is not a valid store id: use ${STORE_ID_RULE} (for example "hirfa").`);
  }
  return value;
}

/** Throws unless the database's marker names exactly this deployment's store. Reads one document; writes nothing. */
export async function assertStoreIdentity(db: Db, env: Env = process.env): Promise<void> {
  if (!storeIdentityEnforced(env)) return;
  const storeId = configuredStoreId(env);
  const dbName = db.databaseName;

  const marker = await db.collection<{ _id: string; storeId?: unknown }>(STORE_IDENTITY_COLLECTION).findOne({ _id: STORE_IDENTITY_DOC_ID });
  if (!marker) {
    throw new StoreIdentityError(
      `Database ${dbName} has no store-identity marker, so this deployment ('${storeId}') cannot tell whose data it holds. Nothing was written. ` +
        `If ${dbName} really is store '${storeId}', adopt it once (dry run first, then without --dry-run): ` +
        `MONGODB_URI=<uri> MONGODB_DB=${dbName} node scripts/admin/adopt-store-identity.mjs --store-id ${storeId} --confirm-db ${dbName} --dry-run. ` +
        "See docs/deployment.md → Store identity."
    );
  }
  if (typeof marker.storeId !== "string") {
    throw new StoreIdentityError(`The store-identity marker in database ${dbName} is malformed (no storeId). It is never repaired automatically.`);
  }
  if (marker.storeId !== storeId) {
    throw new StoreIdentityError(
      `database ${dbName} belongs to store '${marker.storeId}', this deployment is configured as '${storeId}'. ` +
        "Check STORE_ID and MONGODB_DB; the marker is never overwritten."
    );
  }
}
