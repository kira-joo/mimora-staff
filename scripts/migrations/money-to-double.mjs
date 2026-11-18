#!/usr/bin/env node
/*
 * Money storage migration: BSON Decimal128 -> BSON Double, for Mimora's money fields only.
 *
 * The application reads both types (src/server/core/money/money-double-field.ts), so this can run at any time after
 * the code that writes Double is deployed, can stop half-way, and can be repeated. It never decides what is money by
 * looking for Decimal128: it converts only the explicit field list below (kept equal to the schemas by a test), and
 * merely REPORTS a Decimal128 found anywhere else.
 *
 * Modes (the default is a dry run, which is also the read-only production audit):
 *   node scripts/migrations/money-to-double.mjs --env-file=<file>                         audit + plan, writes nothing
 *   node scripts/migrations/money-to-double.mjs --env-file=<file> --execute --confirm-db=<db>
 *   node scripts/migrations/money-to-double.mjs --env-file=<file> --reverse                plan the way back (Double -> Decimal128)
 *   node scripts/migrations/money-to-double.mjs --env-file=<file> --reverse --execute --confirm-db=<db>
 *   node scripts/migrations/money-to-double.mjs --env-file=<file> --verify --log=<change log from an execute>
 *
 * Connection: --env-file=<file> holding MONGODB_URI and MONGODB_DB (read in-process, never printed), or those two
 * variables in the environment. Only the database name and host names are ever printed.
 *
 * Safety:
 *   - A value is converted only when it is exactly representable both ways: finite, not negative, at most two decimal
 *     places, below 1e13. Anything else — a string, an object, a negative, 3+ decimals, NaN — is reported with its
 *     _id and left exactly as it is. The application keeps reading it.
 *   - Each update matches on the value it read (`{ _id, field: <that value> }`), so a document changed by the shop
 *     in the meantime is skipped, not overwritten; the next run picks it up. A second run finds nothing to do.
 *   - Before and after an execute, each field's count and exact decimal sum are fingerprinted; they must be equal.
 *   - Every change is logged (collection, _id, field, old value, new value) to a JSON-lines file, which --verify
 *     re-checks against the database and which is the record of what was done.
 *   - Raw driver writes: no `updatedAt` is bumped, nothing else in the document is touched.
 *   - Any write requires the database's store-identity marker to name mimora.
 *
 * Reverse converts EVERY Double/Int32/Int64 money value back to Decimal128 at two decimals — including values the new
 * code wrote after the forward run, which is what a rollback needs. Every amount the application ever wrote has two
 * decimals, so this restores the original bytes (a test proves it); it cannot invent a different original scale.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import mongodb from "mongodb";

const { MongoClient, Decimal128, Double, BSON } = mongodb;
const { EJSON } = BSON;

/** Every Mimora money field, by collection. Kept equal to the schemas' money paths by money-to-double.test.mjs. */
export const MONEY_FIELDS = {
  variants: ["price", "compareAtPrice", "costPrice"],
  products: ["listing.minActivePrice", "listing.maxActivePrice", "listing.compareAtPrice"],
  deliveryzones: ["fee", "minimumOrder"],
  fulfilmentsettings: ["orderMinimum", "flatShippingFee"],
  orders: ["subtotal", "discount", "tax", "total", "refundedTotal", "fulfilment.fee", "payment.refund.amount", "appliedPromotion.value"],
  orderlines: ["unitPrice", "lineTotal", "unitCost", "lineDiscount"],
  returns: ["refundAmount"],
  promotions: ["value", "conditions.minSubtotal"],
};

/** Two-decimal amounts below this are exact through a double (15 significant digits). */
const MAX_MAGNITUDE = 1e13;
const TWO_DP = /^\d+(\.\d{1,2})?$/;
const TYPE_ORDER = ["decimal", "double", "int", "long", "string", "null", "missing", "object", "other"];
const STORE_IDENTITY_ID = "store-identity";
const DEFAULT_LOG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "money-to-double-logs");

/* ---------------------------------------------------------------- values */

/** The BSON type name of a value as MongoDB's `$type` reports it. */
export function bsonType(value) {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  const tag = value?._bsontype;
  if (tag === "Decimal128") return "decimal";
  if (tag === "Double") return "double";
  if (tag === "Int32") return "int";
  if (tag === "Long") return "long";
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) <= 2147483647 ? "int" : "double";
  if (typeof value === "string") return "string";
  if (typeof value === "object" && !tag) return "object";
  return "other";
}

/** The exact decimal text of a numeric BSON value: Decimal128 as stored; a double through its shortest form. */
function decimalText(value) {
  const tag = value?._bsontype;
  if (tag === "Decimal128") return value.toString();
  if (tag === "Double" || tag === "Int32") return String(value.valueOf());
  if (tag === "Long") return value.toString();
  return String(value);
}

/**
 * Why a stored value cannot be converted, or null when it can. Accepts exactly what the application itself would
 * have written: finite, non-negative, at most two decimals, within the range a double holds exactly at two decimals.
 */
export function valueProblem(value) {
  const type = bsonType(value);
  if (!["decimal", "double", "int", "long"].includes(type)) return `unsupported type ${type}`;
  const text = decimalText(value);
  if (/^-/.test(text)) return "negative";
  if (!/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) return `not a finite number (${text})`;
  // Normalise an exponent or trailing zeros ("19.990", "1.5E+2") before judging the decimal places.
  const normalised = toTwoDecimals(text);
  if (normalised === null) return `more than two decimal places (${text})`;
  if (Number(normalised) >= MAX_MAGNITUDE) return `too large to store exactly as a double (${text})`;
  return null;
}

/** "19.990" -> "19.99", "150" -> "150.00", "1.5E+2" -> "150.00"; null when more than two significant decimals. */
function toTwoDecimals(text) {
  let [mantissa, exponent = "0"] = text.toLowerCase().split("e");
  let [whole, fraction = ""] = mantissa.split(".");
  let shift = Number(exponent);
  let digits = whole + fraction;
  let point = whole.length + shift;
  if (point < 0) { digits = "0".repeat(-point) + digits; point = 0; }
  if (point > digits.length) digits = digits + "0".repeat(point - digits.length);
  whole = digits.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  fraction = digits.slice(point).replace(/0+$/, "");
  if (fraction.length > 2) return null;
  const result = `${whole}.${fraction.padEnd(2, "0")}`;
  return TWO_DP.test(result) ? result : null;
}

/** Forward: the Double to store. Reverse: the Decimal128 to store. Only called after valueProblem() returned null. */
function convert(value, direction) {
  const twoDp = toTwoDecimals(decimalText(value));
  return direction === "forward" ? new Double(Number(twoDp)) : Decimal128.fromString(twoDp);
}

/** Which stored types a direction converts. Forward also normalises a stray Int32/Int64 to Double. */
const SOURCE_TYPES = { forward: ["decimal", "int", "long"], reverse: ["double", "int", "long"] };

/** A logged _id back to its stored form: ObjectId when it is one, else the string as stored. */
function parseId(id) {
  return /^[0-9a-f]{24}$/.test(id) ? new mongodb.ObjectId(id) : id;
}

function getPath(doc, dotted) {
  let node = doc;
  for (const key of dotted.split(".")) {
    if (node === null || typeof node !== "object" || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

/* ---------------------------------------------------------------- audit */

/**
 * Read-only. Per collection: document count. Per money field: count by BSON type, every value that could not be
 * converted (with its _id and reason), and a fingerprint (non-null count, exact decimal sum). Across EVERY
 * collection: any Decimal128 at a path that is not a money field, reported and never touched.
 */
export async function audit(db, { scanUnlisted = true } = {}) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  // Every money collection is reported even when it does not exist yet, so an absent one is visible, not silently skipped.
  const collections = [...new Set([...existing, ...Object.keys(MONEY_FIELDS)])].sort();
  const report = { database: db.databaseName, collections: {}, unlistedDecimal128: {}, totals: { fields: 0, decimal: 0, double: 0, int: 0, long: 0, problems: 0 } };

  for (const name of collections) {
    const fields = MONEY_FIELDS[name] ?? [];
    const entry = { exists: existing.has(name), documents: existing.has(name) ? await db.collection(name).estimatedDocumentCount() : 0, fields: {} };
    if (fields.length) entry.documents = await db.collection(name).countDocuments();
    for (const field of fields) {
      const types = Object.fromEntries(TYPE_ORDER.map((t) => [t, 0]));
      const problems = [];
      const cursor = db.collection(name).find({}, { projection: { [field]: 1 }, promoteValues: false });
      for await (const doc of cursor) {
        const value = getPath(doc, field);
        const type = bsonType(value);
        types[TYPE_ORDER.includes(type) ? type : "other"] += 1;
        if (type === "missing" || type === "null") continue;
        const problem = valueProblem(value);
        if (problem) problems.push({ _id: String(doc._id), type, value: safeText(value), problem });
      }
      entry.fields[field] = { types: Object.fromEntries(Object.entries(types).filter(([, n]) => n > 0)), problems, fingerprint: await fingerprint(db, name, field) };
      report.totals.fields += 1;
      for (const t of ["decimal", "double", "int", "long"]) report.totals[t] += types[t];
      report.totals.problems += problems.length;
    }
    report.collections[name] = entry;
    if (scanUnlisted) {
      for await (const doc of db.collection(name).find({})) {
        for (const found of decimal128Paths(doc)) {
          if (fields.includes(found)) continue;
          const key = `${name}.${found}`;
          report.unlistedDecimal128[key] = (report.unlistedDecimal128[key] ?? 0) + 1;
        }
      }
    }
  }
  return report;
}

function safeText(value) {
  try {
    return value?._bsontype ? `${value._bsontype}(${decimalText(value)})` : JSON.stringify(value)?.slice(0, 80);
  } catch {
    return "<unprintable>";
  }
}

function* decimal128Paths(value, prefix = "") {
  if (value === null || typeof value !== "object") return;
  if (value._bsontype === "Decimal128") {
    yield prefix;
    return;
  }
  if (value._bsontype) return;
  if (Array.isArray(value)) {
    for (const item of value) yield* decimal128Paths(item, prefix ? `${prefix}[]` : "[]");
    return;
  }
  for (const [key, child] of Object.entries(value)) yield* decimal128Paths(child, prefix ? `${prefix}.${key}` : key);
}

/** Non-null numeric count and exact decimal sum of one field — identical before and after a correct migration. */
export async function fingerprint(db, collection, field) {
  const [row] = await db
    .collection(collection)
    .aggregate([
      { $match: { [field]: { $type: "number" } } },
      { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: { $toDecimal: `$${field}` } } } },
    ])
    .toArray();
  return { count: row?.count ?? 0, sum: row ? canonicalDecimal(row.sum.toString()) : "0" };
}

/** An exact decimal in one canonical spelling, so equal amounts compare equal: "19.9900000" and "19.99" -> "19.99". */
function canonicalDecimal(text) {
  if (/e/i.test(text)) return text.toLowerCase();
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/* ---------------------------------------------------------------- migrate */

/**
 * Matches the document only while `field` still holds exactly `value` as a scalar — same BSON type, same value. An
 * `$expr`, not a query predicate: a query-form `$eq` also matches an ARRAY containing the value, which the update would
 * then overwrite.
 */
export function compareAndSetFilter(id, field, value) {
  return { _id: id, $expr: { $and: [{ $eq: [{ $type: `$${field}` }, bsonType(value)] }, { $eq: [`$${field}`, { $literal: value }] }] } };
}

/**
 * Plans (execute=false) or applies (execute=true) one direction. Returns per-field counts. Writes the change log as
 * it goes when `logFile` is given.
 */
export async function migrate(db, { direction = "forward", execute = false, logFile = null, batchSize = 500 } = {}) {
  const sources = SOURCE_TYPES[direction];
  if (!sources) throw new Error(`unknown direction ${direction}`);
  const result = { direction, execute, fields: {}, converted: 0, skippedInvalid: 0, skippedChanged: 0 };

  for (const [collection, fields] of Object.entries(MONEY_FIELDS)) {
    for (const field of fields) {
      const counts = { candidates: 0, converted: 0, invalid: 0, changedMeanwhile: 0 };
      const cursor = db.collection(collection).find({ [field]: { $type: sources } }, { projection: { [field]: 1 }, promoteValues: false });
      let batch = [];
      const flush = async () => {
        if (!batch.length) return;
        if (!execute) {
          counts.converted += batch.length;
          batch = [];
          return;
        }
        let failure = null;
        try {
          await db.collection(collection).bulkWrite(batch.map((b) => b.op), { ordered: false });
        } catch (error) {
          failure = error; // some updates may have landed: they are counted and logged below before this is rethrown
        }
        // Count and log only what verifiably landed: the document now holds exactly the value this run wrote (type and
        // amount). A concurrent shop write, or an update that failed, is never claimed as the migration's.
        const current = await db.collection(collection).find({ _id: { $in: batch.map((b) => b.doc._id) } }, { projection: { [field]: 1 }, promoteValues: false }).toArray();
        const byId = new Map(current.map((d) => [EJSON.stringify(d._id, { relaxed: false }), getPath(d, field)]));
        for (const b of batch) {
          const now = byId.get(b.log.id);
          const landed = now !== undefined && bsonType(now) === b.log.to.type && decimalText(now) === b.log.to.value;
          if (landed) {
            counts.converted += 1;
            if (logFile) appendFileSync(logFile, `${JSON.stringify(b.log)}\n`);
          } else counts.changedMeanwhile += 1;
        }
        batch = [];
        if (failure) throw failure;
      };
      for await (const doc of cursor) {
        const value = getPath(doc, field);
        counts.candidates += 1;
        if (valueProblem(value)) {
          counts.invalid += 1;
          continue;
        }
        const next = convert(value, direction);
        batch.push({
          doc,
          // Compare-and-set on the exact scalar read: same BSON type, same value. `$expr` rather than a query predicate,
          // because a query-form `$eq` also matches an ARRAY containing the value, which would then be overwritten.
          op: {
            updateOne: {
              filter: compareAndSetFilter(doc._id, field, value),
              update: { $set: { [field]: next } },
            },
          },
          log: {
            collection,
            id: EJSON.stringify(doc._id, { relaxed: false }), // typed: an ObjectId, a string or a number round-trips exactly
            _id: String(doc._id),
            field,
            direction,
            from: { type: bsonType(value), value: decimalText(value) },
            to: { type: bsonType(next), value: decimalText(next) },
          },
        });
        if (batch.length >= batchSize) await flush();
      }
      await flush();
      result.fields[`${collection}.${field}`] = counts;
      result.converted += counts.converted;
      result.skippedInvalid += counts.invalid;
      result.skippedChanged += counts.changedMeanwhile;
    }
  }
  return result;
}

/* ---------------------------------------------------------------- verify */

/**
 * After a forward execute: no money field holds Decimal128 except values reported as invalid, every logged change is
 * still in place, and every logged new value equals its old value. Returns { ok, problems }.
 */
export async function verify(db, logEntries = [], { direction = "forward" } = {}) {
  const problems = [];
  const notes = [];
  const expectedType = direction === "forward" ? "double" : "decimal";
  for (const entry of logEntries) {
    if (entry.direction !== direction) continue;
    if (toTwoDecimals(entry.from.value) !== toTwoDecimals(entry.to.value)) problems.push(`${entry.collection} ${entry._id} ${entry.field}: logged ${entry.from.value} -> ${entry.to.value} changes the amount`);
    const id = entry.id ? EJSON.parse(entry.id, { relaxed: false }) : parseId(entry._id);
    const doc = await db.collection(entry.collection).findOne({ _id: id }, { projection: { [entry.field]: 1 }, promoteValues: false });
    if (!doc) {
      notes.push(`${entry.collection} ${entry._id}: deleted since the migration — nothing to verify`);
      continue;
    }
    const value = getPath(doc, entry.field);
    if (bsonType(value) !== expectedType) {
      problems.push(`${entry.collection} ${entry._id} ${entry.field}: now holds ${bsonType(value)}, expected ${expectedType}`);
    } else if (toTwoDecimals(decimalText(value)) !== toTwoDecimals(entry.to.value)) {
      notes.push(`${entry.collection} ${entry._id} ${entry.field}: holds ${decimalText(value)}, the migration wrote ${entry.to.value} — changed by the shop since (a normal edit, not a migration error)`);
    }
  }
  const remaining = {};
  for (const [collection, fields] of Object.entries(MONEY_FIELDS)) {
    for (const field of fields) {
      const leftover = direction === "forward" ? ["decimal", "int", "long"] : ["double", "int", "long"];
      for await (const doc of db.collection(collection).find({ [field]: { $type: leftover } }, { projection: { [field]: 1 }, promoteValues: false })) {
        if (valueProblem(getPath(doc, field))) continue; // invalid values are reported by the audit, never converted
        remaining[`${collection}.${field}`] = (remaining[`${collection}.${field}`] ?? 0) + 1;
      }
    }
  }
  for (const [key, n] of Object.entries(remaining)) problems.push(`${key}: ${n} convertible value(s) still not ${expectedType}`);
  return { ok: problems.length === 0, problems, notes };
}

/* ---------------------------------------------------------------- CLI */

function fail(message) {
  console.error(`refused: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { envFile: null, dryRun: false, execute: false, reverse: false, verify: false, confirm: null, log: null, logDir: DEFAULT_LOG_DIR, json: false };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--reverse") args.reverse = true;
    else if (arg === "--verify") args.verify = true;
    else if (arg === "--json") args.json = true;
    else if (arg.startsWith("--env-file=")) args.envFile = arg.slice("--env-file=".length);
    else if (arg.startsWith("--confirm-db=")) args.confirm = arg.slice("--confirm-db=".length);
    else if (arg.startsWith("--log=")) args.log = arg.slice("--log=".length);
    else if (arg.startsWith("--log-dir=")) args.logDir = arg.slice("--log-dir=".length);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else fail(`unknown option ${arg} (see the header of this file)`);
  }
  if (args.verify && args.execute) fail("--verify only reads; do not combine it with --execute");
  if (args.dryRun && args.execute) fail("--dry-run and --execute contradict each other; give exactly one (a dry run is the default)");
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

/**
 * This tool is for Mimora's database. The marker is the canonical one the backend checks at boot (`_id: "store-identity"`,
 * written only by scripts/admin/adopt-store-identity.mjs). Any WRITE requires it to name mimora, wherever the database
 * is — a localhost address may be a tunnel. A read-only run (dry run, verify) is also allowed on an unmarked local
 * database, for rehearsals on copies.
 */
async function assertMimora(db, uri, { writes }) {
  const identity = await db.collection("storeidentity").findOne({ _id: STORE_IDENTITY_ID });
  if (identity && identity.storeId !== "mimora") fail(`${db.databaseName} identifies as store "${identity.storeId}", not mimora`);
  if (!identity && writes) fail(`${db.databaseName} has no store-identity marker naming mimora; refusing to write to it`);
  if (!identity && !isLocal(uri)) fail(`${db.databaseName} has no store-identity marker; refusing a remote database that is not adopted as mimora`);
}

function printAudit(report) {
  console.log(`\nAudit of ${report.database}`);
  for (const [name, entry] of Object.entries(report.collections)) {
    const fields = Object.entries(entry.fields);
    if (!fields.length) continue;
    console.log(`\n  ${name}: ${entry.exists ? `${entry.documents} document(s)` : "collection does not exist (0 documents)"}`);
    for (const [field, info] of fields) {
      const types = Object.entries(info.types).map(([t, n]) => `${t} ${n}`).join(", ") || "none";
      console.log(`    ${field.padEnd(26)} ${types}   | ${info.fingerprint.count} amount(s), sum ${info.fingerprint.sum}`);
      for (const p of info.problems) console.log(`      ! ${p._id}: ${p.problem} — ${p.value}`);
    }
  }
  const others = Object.entries(report.collections).filter(([, e]) => !Object.keys(e.fields).length).map(([n, e]) => `${n} (${e.documents})`);
  console.log(`\n  Collections with no money fields: ${others.join(", ") || "none"}`);
  const unlisted = Object.entries(report.unlistedDecimal128);
  console.log(unlisted.length ? `\n  Decimal128 OUTSIDE the money fields (reported, never touched):\n${unlisted.map(([k, n]) => `    ${k}: ${n}`).join("\n")}` : "\n  No Decimal128 anywhere outside the money fields.");
  const t = report.totals;
  console.log(`\n  Totals: ${t.fields} money fields; values stored as decimal ${t.decimal}, double ${t.double}, int ${t.int}, long ${t.long}; ${t.problems} value(s) that will NOT be converted.`);
}

function sameFingerprints(before, after) {
  const differences = [];
  for (const [name, entry] of Object.entries(before.collections)) {
    for (const [field, info] of Object.entries(entry.fields)) {
      const next = after.collections[name]?.fields[field]?.fingerprint;
      if (!next || next.count !== info.fingerprint.count || next.sum !== info.fingerprint.sum) {
        differences.push(`${name}.${field}: before ${info.fingerprint.count} / ${info.fingerprint.sum}, after ${next?.count} / ${next?.sum}`);
      }
    }
  }
  return differences;
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
  if (args.execute && args.confirm !== dbName) fail(`an execute needs --confirm-db=${"<database name>"} matching MONGODB_DB exactly`);

  const direction = args.reverse ? "reverse" : "forward";
  const mode = args.verify ? "VERIFY (read-only)" : args.execute ? `EXECUTE ${direction}` : `DRY RUN ${direction} (read-only, nothing is written)`;
  console.log(`money-to-double — ${mode}\n  database: ${describe(uri, dbName)}`);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  try {
    const db = client.db(dbName);
    await assertMimora(db, uri, { writes: args.execute });

    if (args.verify) {
      const entries = args.log ? readFileSync(args.log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
      const report = await audit(db);
      printAudit(report);
      const result = await verify(db, entries, { direction });
      console.log(`\nVerify (${entries.length} logged change(s) re-checked): ${result.ok ? "OK" : "FAILED"}`);
      result.problems.forEach((p) => console.log(`  ✗ ${p}`));
      result.notes.forEach((n) => console.log(`  · ${n}`));
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    const before = await audit(db);
    printAudit(before);
    if (args.json) console.log(`\nJSON:\n${JSON.stringify(before, null, 2)}`);

    let logFile = null;
    if (args.execute) {
      mkdirSync(args.logDir, { recursive: true });
      logFile = path.join(args.logDir, `${dbName}-${direction}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
    }
    const plan = await migrate(db, { direction, execute: args.execute, logFile });
    console.log(`\n${args.execute ? "Converted" : "Would convert"} (${direction === "forward" ? "-> Double" : "-> Decimal128"}):`);
    for (const [field, c] of Object.entries(plan.fields)) {
      if (!c.candidates) continue;
      console.log(`  ${field.padEnd(40)} ${c.converted}${c.invalid ? `, ${c.invalid} left as they are (invalid, listed above)` : ""}${c.changedMeanwhile ? `, ${c.changedMeanwhile} changed by the shop meanwhile — run again` : ""}`);
    }
    console.log(`  total: ${plan.converted} value(s)${plan.skippedInvalid ? `; ${plan.skippedInvalid} invalid left untouched` : ""}${plan.skippedChanged ? `; ${plan.skippedChanged} to retry` : ""}`);

    if (args.execute) {
      const after = await audit(db, { scanUnlisted: false });
      const differences = sameFingerprints(before, after);
      console.log(differences.length ? `\nFINGERPRINT MISMATCH — amounts changed:\n${differences.map((d) => `  ✗ ${d}`).join("\n")}` : "\nFingerprints identical before and after: every field's count and exact sum are unchanged.");
      const result = await verify(db, readFileSync(logFile, { encoding: "utf8", flag: "a+" }).split("\n").filter(Boolean).map((l) => JSON.parse(l)), { direction });
      console.log(`Verify: ${result.ok ? "OK" : "FAILED"}`);
      result.problems.forEach((p) => console.log(`  ✗ ${p}`));
      console.log(`Change log: ${logFile}`);
      process.exitCode = differences.length || !result.ok ? 1 : 0;
    } else {
      console.log(`\nNothing was written. To apply: add --execute --confirm-db=${dbName}`);
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
