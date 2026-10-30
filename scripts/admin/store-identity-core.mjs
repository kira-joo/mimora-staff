// The store-identity marker: one document in the database saying WHICH store's data it holds, adopted once
// by an operator and checked at every backend boot (src/server/core/db/store-identity.ts). This module is
// the ONLY writer of that document. It never modifies an existing marker and never touches any other
// collection; the preflight only READS.
//
// Plain .mjs on the MongoDB driver (no TypeScript runtime in production images); the values it shares with the
// application are pinned by store-identity.integration.test.ts so they cannot drift.
import { describeTarget } from "./bootstrap-owner-core.mjs";

/** = STORE_IDENTITY_COLLECTION (src/server/core/db/store-identity.ts). Not a Mongoose model: no schema, one document. */
export const MARKER_COLLECTION = "storeidentity";
/** = STORE_IDENTITY_DOC_ID. */
export const MARKER_ID = "store-identity";
/** = STORE_ID_PATTERN: a short, stable, lowercase slug, 1-40 characters. */
export const STORE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const ADOPTED_VIA = "scripts/admin/adopt-store-identity.mjs";
/** Mongoose's collection names for StoreProfile, Product, Order and Customer; read-only, for the preflight. */
export const PREFLIGHT_COLLECTIONS = { profile: "storeprofiles", products: "products", orders: "orders", customers: "customers" };

export class StoreIdentityRefusal extends Error {}

const FLAGS = new Set(["dry-run"]);
const VALUED = new Set(["store-id", "confirm-db"]);

/**
 * `--key value` and `--key=value` both work (the usage line shows the first); `--dry-run` is a bare flag. Anything
 * unknown is refused rather than ignored — a mistyped `--confirm-bd` must not silently mean "not confirmed, carry on".
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) throw new StoreIdentityRefusal(`Unexpected argument "${raw}".`);
    const [key, inline] = raw.slice(2).split(/=(.*)/s);
    if (FLAGS.has(key)) {
      if (inline !== undefined) throw new StoreIdentityRefusal(`--${key} takes no value.`);
      args[key] = true;
    } else if (VALUED.has(key)) {
      const value = inline !== undefined ? inline : argv[++i];
      if (value === undefined || value.startsWith("--")) throw new StoreIdentityRefusal(`--${key} needs a value.`);
      args[key] = value;
    } else {
      throw new StoreIdentityRefusal(`Unknown option --${key}.`);
    }
  }
  return args;
}

/** The slug rule, separate so it is testable. */
export function assertStoreId(storeId) {
  if (typeof storeId !== "string" || !storeId) throw new StoreIdentityRefusal("--store-id is required (for example --store-id mimora).");
  if (!STORE_ID_PATTERN.test(storeId)) {
    throw new StoreIdentityRefusal(
      `--store-id "${storeId}" is not a valid store id: use 1-40 lowercase letters, digits and hyphens, starting and ending with a letter or digit (for example "mimora").`
    );
  }
  return storeId;
}

/**
 * The confirmation rule: --confirm-db must equal MONGODB_DB EXACTLY, always, local or not. The marker is meant to be
 * permanent, so typing the database name out is the cheapest defence against adopting the wrong one.
 */
export function assertConfirmed(dbName, confirmDb) {
  if (typeof confirmDb !== "string" || !confirmDb) {
    throw new StoreIdentityRefusal(`--confirm-db is required: re-run with --confirm-db ${dbName} to confirm this is the database you mean.`);
  }
  if (confirmDb !== dbName) {
    throw new StoreIdentityRefusal(`--confirm-db "${confirmDb}" does not match MONGODB_DB "${dbName}". Nothing was written.`);
  }
}

/** MONGODB_URI and MONGODB_DB checked, hosts derived. Never returns or echoes the credentials. */
export function resolveTarget(uri, dbName) {
  if (!dbName) throw new StoreIdentityRefusal("MONGODB_DB is required — adoption never guesses which database to mark.");
  return describeTarget(uri, dbName);
}

/**
 * Everything the operator needs to recognise whose data this is, by READING only: the existing marker, the store
 * profile's name and currency, and the sizes of the collections that say how much this store has done.
 */
export async function preflight(db) {
  const marker = await db.collection(MARKER_COLLECTION).findOne({ _id: MARKER_ID });
  const profile = await db
    .collection(PREFLIGHT_COLLECTIONS.profile)
    .findOne({}, { projection: { "name.ar": 1, "name.en": 1, currency: 1 } });
  const counts = {};
  for (const key of ["products", "orders", "customers"]) counts[key] = await db.collection(PREFLIGHT_COLLECTIONS[key]).countDocuments({});
  return {
    dbName: db.databaseName,
    marker: marker ? { storeId: marker.storeId, adoptedAt: marker.adoptedAt, adoptedVia: marker.adoptedVia } : null,
    profile: profile ? { nameAr: profile.name?.ar ?? null, nameEn: profile.name?.en ?? null, currency: profile.currency ?? null } : null,
    counts,
  };
}

const mismatch = (dbName, marker, requested) =>
  new StoreIdentityRefusal(`database ${dbName} belongs to store '${marker}', so it cannot be adopted as '${requested}'. The existing marker is never changed by this script.`);

/**
 * Adopts the database for `storeId`: ONE atomic insert-if-absent of the marker, then a read-back that decides the
 * outcome. Two operators running at once cannot both win — the insert is a single-document upsert on a fixed `_id`
 * (a concurrent loser sees a duplicate-key error, treated as "someone else inserted first") and every run, winner or
 * not, then reads the marker and compares it with what it asked for. A different store id is a refusal, never an
 * overwrite. Nothing outside the marker collection is written, and a dry run writes nothing at all.
 *
 * `confirmDb` is checked here as well as by the command, so no caller can reach a write without it.
 */
export async function adoptStoreIdentity(db, { storeId, confirmDb, dryRun = false, now = new Date(), via = ADOPTED_VIA }) {
  assertStoreId(storeId);
  assertConfirmed(db.databaseName, confirmDb);
  const markers = db.collection(MARKER_COLLECTION);

  if (dryRun) {
    const existing = await markers.findOne({ _id: MARKER_ID });
    if (!existing) return { action: "would-adopt", storeId };
    if (existing.storeId !== storeId) throw mismatch(db.databaseName, existing.storeId, storeId);
    return { action: "already-adopted", storeId, marker: existing };
  }

  let inserted = false;
  try {
    const result = await markers.updateOne({ _id: MARKER_ID }, { $setOnInsert: { storeId, adoptedAt: now, adoptedVia: via } }, { upsert: true });
    inserted = result.upsertedCount === 1;
  } catch (error) {
    if (error?.code !== 11000) throw error; // a concurrent upsert won the insert; the read-back below decides
  }

  const marker = await markers.findOne({ _id: MARKER_ID });
  if (!marker) throw new StoreIdentityRefusal(`the marker could not be read back from ${db.databaseName} after writing it; nothing is adopted.`);
  if (marker.storeId !== storeId) throw mismatch(db.databaseName, marker.storeId, storeId);
  return { action: inserted ? "adopted" : "already-adopted", storeId, marker };
}
