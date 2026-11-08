#!/usr/bin/env node
/*
 * Copies the store data a new deployment needs (catalog, settings, content) from one database to another, byte-for-byte:
 * every document keeps its _id and every BSON type (Decimal128 prices, ObjectId references, dates).
 *
 * It NEVER overwrites. A document already in the target with the same _id is compared: identical is "already copied",
 * different is a conflict, and any conflict stops the run before anything is written. The writes run in one
 * transaction, so a run lands completely or not at all, and repeating a run changes nothing.
 *
 * What it does not copy, on purpose:
 *   - storeidentity: the adoption script (scripts/admin/adopt-store-identity.mjs) is its only writer. Run it first.
 *   - permissions, roles: seeded by the backend at boot.
 *   - staffusers: the first Owner is created with scripts/admin/bootstrap-owner.mjs.
 *   - orders and their lines, sequences, returns, carts, customers, sessions and refresh tokens, idempotency records,
 *     rate limits, activity logs, notifications, pending uploads: transactional, personal or development state.
 *
 * Usage (the target's credentials are read from a file and never printed):
 *   node scripts/migrations/copy-store-to-target.mjs --target-env=.env.atlas.local --dry-run
 *   node scripts/migrations/copy-store-to-target.mjs --target-env=.env.atlas.local --confirm-target-db=<target db name>
 *   node scripts/migrations/copy-store-to-target.mjs --target-env=.env.atlas.local --verify
 * Source defaults to the local replica set (SOURCE_MONGODB_URI / SOURCE_MONGODB_DB override it).
 */
import { readFileSync } from "node:fs";
import mongodb from "mongodb";
const { MongoClient, BSON } = mongodb;
const { EJSON } = BSON;

/** Copied, in dependency order. Singletons must hold at most one document on each side. */
const COLLECTIONS = [
  "storeprofiles",
  "paymentsettings",
  "fulfilmentsettings",
  "deliveryzones",
  "pickuplocations",
  "brands",
  "sizeguides",
  "categories",
  "collections",
  "products",
  "variants",
  "stockmovements",
  "promotions",
  "pages",
  "pagerevisions",
  "storefrontcontents",
];
const SINGLETONS = new Set(["storeprofiles", "paymentsettings", "fulfilmentsettings", "storefrontcontents"]);
/** Fields that point at a staff account. Staff accounts are not copied, so these are reported, not treated as broken. */
const STAFF_REFERENCE_FIELDS = new Set(["actorId", "publishedBy", "createdBy", "updatedBy", "stagedBy"]);

const STORE_IDENTITY_ID = "store-identity";

function fail(message) {
  console.error(`refused: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { targetEnv: null, dryRun: false, verify: false, confirm: null };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--verify") args.verify = true;
    else if (arg.startsWith("--target-env=")) args.targetEnv = arg.slice("--target-env=".length);
    else if (arg.startsWith("--confirm-target-db=")) args.confirm = arg.slice("--confirm-target-db=".length);
    else fail(`unknown option ${arg}`);
  }
  if (!args.targetEnv) fail("--target-env=<file> is required (a file holding MONGODB_URI and MONGODB_DB for the target)");
  if (!args.dryRun && !args.verify && !args.confirm) fail("a real run needs --confirm-target-db=<target database name> (or use --dry-run / --verify)");
  return args;
}

function readEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`cannot read ${path}`);
  }
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

/** Hosts only — never the user, password or query string. */
function describe(uri, db) {
  const hosts = uri.replace(/^mongodb(\+srv)?:\/\//, "").replace(/^[^@]*@/, "").split(/[/?]/)[0];
  return `${db} @ ${hosts}`;
}

const canonical = (doc) => EJSON.stringify(doc, { relaxed: false });

function* objectIds(value, path = "") {
  if (value === null || typeof value !== "object") return;
  if (value._bsontype === "ObjectId") {
    yield { path, id: value };
    return;
  }
  if (value._bsontype) return;
  if (Array.isArray(value)) {
    for (const item of value) yield* objectIds(item, path);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (path === "" && key === "_id") continue;
    yield* objectIds(child, path ? `${path}.${key}` : key);
  }
}

async function plan(source, target) {
  const result = [];
  for (const name of COLLECTIONS) {
    const docs = await source.collection(name).find({}).sort({ _id: 1 }).toArray();
    const targetDocs = await target.collection(name).find({}).toArray();
    const sourceById = new Map(docs.map((d) => [canonical(d._id), d]));
    const targetById = new Map(targetDocs.map((d) => [canonical(d._id), d]));

    const toInsert = [];
    const same = [];
    const conflicts = [];
    for (const [key, doc] of sourceById) {
      const existing = targetById.get(key);
      if (!existing) toInsert.push(doc);
      else if (canonical(existing) === canonical(doc)) same.push(doc);
      else conflicts.push(`${name} ${key}: exists in the target with different content`);
    }
    for (const key of targetById.keys()) {
      if (!sourceById.has(key)) conflicts.push(`${name} ${key}: exists only in the target (not data from this source)`);
    }
    if (SINGLETONS.has(name) && docs.length > 1) conflicts.push(`${name}: the source holds ${docs.length} documents; a singleton must hold one`);
    result.push({ name, source: docs.length, targetBefore: targetDocs.length, toInsert, same, conflicts });
  }
  return result;
}

/** Every ObjectId inside a copied document must name a copied document (staff references are listed separately). */
async function checkReferences(db) {
  const known = new Set();
  for (const name of COLLECTIONS) for (const { _id } of await db.collection(name).find({}, { projection: { _id: 1 } }).toArray()) known.add(String(_id));
  const broken = [];
  const staff = new Map();
  let checked = 0;
  for (const name of COLLECTIONS) {
    for (const doc of await db.collection(name).find({}).toArray()) {
      for (const { path, id } of objectIds(doc)) {
        const field = path.split(".").pop();
        if (STAFF_REFERENCE_FIELDS.has(field)) {
          const key = `${name}.${path}`;
          staff.set(key, (staff.get(key) ?? 0) + 1);
          continue;
        }
        checked += 1;
        if (!known.has(String(id))) broken.push(`${name} ${doc._id} ${path} -> ${id}`);
      }
    }
  }
  return { checked, broken, staff };
}

async function verify(source, target) {
  let ok = true;
  console.log("\ncollection              source  target  identical");
  for (const name of COLLECTIONS) {
    const docs = await source.collection(name).find({}).toArray();
    let identical = 0;
    for (const doc of docs) {
      const copy = await target.collection(name).findOne({ _id: doc._id });
      if (copy && canonical(copy) === canonical(doc)) identical += 1;
    }
    const targetCount = await target.collection(name).countDocuments();
    if (identical !== docs.length || targetCount !== docs.length) ok = false;
    console.log(`${name.padEnd(22)} ${String(docs.length).padStart(7)} ${String(targetCount).padStart(7)} ${String(identical).padStart(10)}`);
  }
  const refs = await checkReferences(target);
  console.log(`\nreferences checked in the target: ${refs.checked}, broken: ${refs.broken.length}`);
  for (const line of refs.broken) console.log(`  broken: ${line}`);
  for (const [field, n] of refs.staff) console.log(`  staff reference (staff accounts are not copied): ${field} x${n}`);
  if (refs.broken.length) ok = false;
  console.log(ok ? "\nverify: OK — every copied document is identical to its source and every reference resolves" : "\nverify: FAILED");
  return ok;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetEnv = readEnvFile(args.targetEnv);
  const targetUri = targetEnv.MONGODB_URI;
  const targetDb = targetEnv.MONGODB_DB;
  if (!targetUri || !targetDb) fail(`${args.targetEnv} must set both MONGODB_URI and MONGODB_DB`);
  if (args.confirm && args.confirm !== targetDb) fail("--confirm-target-db does not match the target's MONGODB_DB");

  const sourceUri = process.env.SOURCE_MONGODB_URI || "mongodb://localhost:27020/?replicaSet=rs0&directConnection=true";
  const sourceDb = process.env.SOURCE_MONGODB_DB || "store-platform-staff";
  if (describe(sourceUri, sourceDb) === describe(targetUri, targetDb)) fail("the source and the target are the same database");

  console.log(`source: ${describe(sourceUri, sourceDb)}`);
  console.log(`target: ${describe(targetUri, targetDb)}`);

  const sourceClient = new MongoClient(sourceUri, { serverSelectionTimeoutMS: 10000 });
  const targetClient = new MongoClient(targetUri, { serverSelectionTimeoutMS: 15000 });
  try {
    await sourceClient.connect();
    await targetClient.connect();
    const source = sourceClient.db(sourceDb);
    const target = targetClient.db(targetDb);

    const sourceMarker = await source.collection("storeidentity").findOne({ _id: STORE_IDENTITY_ID });
    const targetMarker = await target.collection("storeidentity").findOne({ _id: STORE_IDENTITY_ID });
    console.log(`source store: ${sourceMarker?.storeId ?? "(no marker)"}; target store: ${targetMarker?.storeId ?? "(no marker)"}`);
    if (!sourceMarker?.storeId) fail("the source database has no store-identity marker");

    if (args.verify) {
      process.exitCode = (await verify(source, target)) ? 0 : 1;
      return;
    }

    const steps = await plan(source, target);
    console.log("\ncollection              source  in target  to copy  already copied");
    for (const s of steps) {
      console.log(`${s.name.padEnd(22)} ${String(s.source).padStart(7)} ${String(s.targetBefore).padStart(10)} ${String(s.toInsert.length).padStart(8)} ${String(s.same.length).padStart(15)}`);
    }
    const conflicts = steps.flatMap((s) => s.conflicts);
    for (const c of conflicts) console.log(`  conflict: ${c}`);

    if (targetMarker?.storeId !== sourceMarker.storeId) {
      const why = targetMarker ? `is adopted as '${targetMarker.storeId}'` : "has no store-identity marker";
      const message = `the target ${why}; adopt it as '${sourceMarker.storeId}' first with scripts/admin/adopt-store-identity.mjs`;
      if (args.dryRun) console.log(`\nwould refuse: ${message}`);
      else fail(message);
    }
    if (conflicts.length) {
      if (args.dryRun) console.log(`\nwould refuse: ${conflicts.length} conflict(s); nothing in the target is ever overwritten`);
      else fail(`${conflicts.length} conflict(s) above; nothing was written and nothing in the target is ever overwritten`);
    }

    const total = steps.reduce((n, s) => n + s.toInsert.length, 0);
    if (args.dryRun) {
      console.log(`\ndry run: ${total} document(s) would be copied; nothing was written`);
      return;
    }
    if (total === 0) {
      console.log("\nnothing to copy: the target already holds every document, identical");
      return;
    }

    const session = targetClient.startSession();
    try {
      await session.withTransaction(async () => {
        for (const s of steps) {
          for (const doc of s.toInsert) {
            // Re-checked inside the transaction: a document that appeared since the plan is never overwritten.
            await target.collection(s.name).insertOne(doc, { session });
          }
        }
      });
    } finally {
      await session.endSession();
    }
    console.log(`\ncopied ${total} document(s) in one transaction`);
    process.exitCode = (await verify(source, target)) ? 0 : 1;
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
}

main().catch((error) => {
  // The driver's message can name the host; it never carries the password, but strip any URI to be sure.
  console.error(`failed: ${String(error?.message ?? error).replace(/mongodb(\+srv)?:\/\/\S+/g, "<uri>")}`);
  process.exit(1);
});
