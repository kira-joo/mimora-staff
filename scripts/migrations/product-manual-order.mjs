#!/usr/bin/env node
/*
 * Product manual order: normalise `products.order` to 1..N.
 *
 * Manual ordering (src/server/engines/product-order) treats `Product.order` as the persistent position, with ties
 * broken newest-first. Every product written before it existed holds order 0, so the catalogue reads "newest first"
 * through that tie-break. This script renumbers EVERY product 1..N following exactly that canonical order — `order`
 * ascending, then `createdAt` descending, then `_id` descending — so the visible order does not change at all, and
 * from then on each position is unique (a later arrangement or an appended product never has to resolve a tie).
 * It is OPTIONAL: nothing needs it to run, and an un-migrated catalogue behaves identically.
 *
 *   node scripts/migrations/product-manual-order.mjs --env-file=<file>                          dry run: counts only, writes nothing
 *   node scripts/migrations/product-manual-order.mjs --env-file=<file> --apply --confirm-db=<db>
 *   ... --apply --confirm-db=<db> --log=<file.jsonl>                                              also record every change (id, from, to)
 *
 * Connection: --env-file=<file> holding MONGODB_URI and MONGODB_DB (read in-process, never printed), or those two
 * variables in the environment. Only the database name and host names are ever printed.
 *
 * Safety:
 *   - Dry run is the default. `--apply` requires `--confirm-db=<name>` equal to MONGODB_DB, exactly.
 *   - Any write requires the database's store-identity marker to name mimora (same rule as money-to-double.mjs).
 *   - Idempotent: only products whose `order` differs from their canonical position are written; a second run finds 0.
 *   - Each update matches the `order` it read, so a product changed by staff mid-run is skipped, never overwritten
 *     (run again to pick it up). Raw driver writes: only `order` is set; `updatedAt` and everything else are untouched.
 *   - Cache: this is a migration, it publishes no invalidation. The visible order is unchanged, so none is needed.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import mongodb from "mongodb";

const { MongoClient } = mongodb;
const STORE_IDENTITY_ID = "store-identity";

const time = (value) => (value instanceof Date ? value.getTime() : new Date(value ?? 0).getTime()) || 0;
const idText = (id) => String(id);

/**
 * The canonical order of the catalogue. MUST equal `compareProductsManual` in
 * src/server/engines/product-order/product-order.ts (a test holds the two together).
 */
export function canonicalOrder(products) {
  return [...products].sort((a, b) => {
    const orderA = a.order ?? 0;
    const orderB = b.order ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    const byCreated = time(b.createdAt) - time(a.createdAt);
    if (byCreated !== 0) return byCreated;
    return idText(a._id) < idText(b._id) ? 1 : idText(a._id) > idText(b._id) ? -1 : 0;
  });
}

/** Position `i` becomes `order = i + 1`; only products whose stored `order` differs are returned. */
export function planRenumber(products) {
  const sorted = canonicalOrder(products);
  const changes = [];
  sorted.forEach((product, index) => {
    if (product.order !== index + 1) changes.push({ _id: product._id, from: product.order, to: index + 1 });
  });
  return { total: sorted.length, sorted, changes };
}

const loadProducts = (db) => db.collection("products").find({}, { projection: { order: 1, createdAt: 1 } }).toArray();

/** The catalogue as it reads today: product ids in canonical order. */
export async function visibleOrder(db) {
  return canonicalOrder(await loadProducts(db)).map((product) => idText(product._id));
}

/** Plans (apply=false) or applies (apply=true). Returns counts; `skippedChanged` are products edited mid-run. */
export async function renumber(db, { apply = false, logFile = null } = {}) {
  const { total, changes } = planRenumber(await loadProducts(db));
  const result = { total, wouldChange: changes.length, changed: 0, skippedChanged: 0 };
  if (!apply || changes.length === 0) return result;

  const BATCH = 500;
  for (let start = 0; start < changes.length; start += BATCH) {
    const batch = changes.slice(start, start + BATCH);
    const outcome = await db.collection("products").bulkWrite(
      batch.map((change) => ({
        updateOne: {
          filter: { _id: change._id, order: change.from === undefined ? { $exists: false } : change.from },
          update: { $set: { order: change.to } },
        },
      })),
      { ordered: false }
    );
    result.changed += outcome.modifiedCount;
    result.skippedChanged += batch.length - outcome.modifiedCount;
    if (logFile) for (const change of batch) appendFileSync(logFile, `${JSON.stringify({ id: idText(change._id), from: change.from ?? null, to: change.to })}\n`);
  }
  return result;
}

/* ---------------------------------------------------------------- CLI */

function fail(message) {
  console.error(`refused: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { envFile: null, apply: false, confirm: null, log: null };
  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg.startsWith("--env-file=")) args.envFile = arg.slice("--env-file=".length);
    else if (arg.startsWith("--confirm-db=")) args.confirm = arg.slice("--confirm-db=".length);
    else if (arg.startsWith("--log=")) args.log = arg.slice("--log=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else fail(`unknown option ${arg} (see the header of this file)`);
  }
  return args;
}

function readEnvFile(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    fail(`cannot read ${file}`);
  }
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

/** Hosts only — never the user, password or query string. */
function describe(uri, db) {
  const hosts = uri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split(/[/?]/)[0];
  return `${db} @ ${hosts}`;
}

const isLocal = (uri) => /^mongodb:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?[/?]/.test(uri.replace(/^mongodb:\/\/[^@/]*@/, "mongodb://"));

/** Same rule as money-to-double.mjs: a write needs the marker to name mimora; a read-only run may use an unmarked LOCAL copy. */
async function assertMimora(db, uri, { writes }) {
  const identity = await db.collection("storeidentity").findOne({ _id: STORE_IDENTITY_ID });
  if (identity && identity.storeId !== "mimora") fail(`${db.databaseName} identifies as store "${identity.storeId}", not mimora`);
  if (!identity && writes) fail(`${db.databaseName} has no store-identity marker naming mimora; refusing to write to it`);
  if (!identity && !isLocal(uri)) fail(`${db.databaseName} has no store-identity marker; refusing a remote database that is not adopted as mimora`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
    return;
  }
  const env = args.envFile ? readEnvFile(args.envFile) : process.env;
  const uri = env.MONGODB_URI;
  const dbName = env.MONGODB_DB;
  if (!uri || !dbName) fail(`${args.envFile ?? "the environment"} must set both MONGODB_URI and MONGODB_DB`);
  if (args.apply && args.confirm !== dbName) fail("--apply needs --confirm-db=<database name> matching MONGODB_DB exactly");

  console.log(`product-manual-order — ${args.apply ? "APPLY" : "DRY RUN (read-only, nothing is written)"}\n  database: ${describe(uri, dbName)}`);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  try {
    const db = client.db(dbName);
    await assertMimora(db, uri, { writes: args.apply });

    const before = await visibleOrder(db);
    const result = await renumber(db, { apply: args.apply, logFile: args.log });
    console.log(`\n  products:        ${result.total}`);
    console.log(`  ${args.apply ? "would have changed" : "would change"}:    ${result.wouldChange}`);
    if (args.apply) {
      console.log(`  changed:         ${result.changed}`);
      console.log(`  skipped (edited mid-run, run again): ${result.skippedChanged}`);
      const after = await visibleOrder(db);
      const same = before.length === after.length && before.every((id, index) => id === after[index]);
      console.log(`  visible order unchanged: ${same ? "yes" : "NO"}`);
      if (!same) process.exitCode = 1;
      if (args.log) console.log(`  change log:      ${args.log}`);
    } else {
      console.log(`\nNothing was written. To apply: add --apply --confirm-db=${dbName}`);
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nError: ${error.message}`);
    process.exitCode = 1;
  });
}
