import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import mongodb from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALL_MODELS } from "../../src/server/core/db/model-registry";
import { moneyPaths } from "../../src/server/core/money/money-double-field";
import { MONEY_FIELDS, audit, bsonType, compareAndSetFilter, migrate, valueProblem, verify } from "./money-to-double.mjs";

const { MongoClient, Decimal128, Double, Int32, ObjectId, BSON } = mongodb;
const canonical = (docs) => BSON.EJSON.stringify(docs, { relaxed: false });

/**
 * The money storage migration against a THROWAWAY local database (created per run, dropped afterwards). Covers the
 * guarantees the production run relies on: the dry run writes nothing, only listed money fields change, amounts are
 * unchanged, invalid values are left alone, a second run is a no-op, and the reverse restores the original bytes.
 */
const URI = "mongodb://localhost:27020/?replicaSet=rs0&directConnection=true";
const DB_NAME = `store-platform-staff-test-money-${process.pid}-${Date.now()}`;
let client;
let db;
const d128 = (s) => Decimal128.fromString(s);

async function seed() {
  await db.dropDatabase();
  const orderId = new ObjectId();
  await db.collection("variants").insertMany([
    { _id: new ObjectId(), sku: "A", price: d128("560.00"), compareAtPrice: d128("600.00"), costPrice: d128("19.99"), weight: 1.25, stock: 3, updatedAt: new Date("2026-01-01") },
    { _id: new ObjectId(), sku: "B", price: d128("0.10"), stock: 1, updatedAt: new Date("2026-01-01") },
    { _id: new ObjectId(), sku: "C", price: d128("12.345"), stock: 1 }, // 3 decimals: invalid, must be left alone
    { _id: new ObjectId(), sku: "D", price: "560.00", stock: 1 }, // a string: invalid, must be left alone
    { _id: new ObjectId(), sku: "E", price: d128("-5.00"), stock: 1 }, // negative: unexpected, left alone
    { _id: new ObjectId(), sku: "F", price: new Double(75), stock: 1 }, // already migrated
    { _id: new ObjectId(), sku: "G", price: new Int32(80), stock: 1 }, // stray Int32: normalised to Double
  ]);
  await db.collection("products").insertOne({ _id: new ObjectId(), listing: { minActivePrice: d128("19.50"), maxActivePrice: d128("600.00") }, ratingsSummary: { average: 4.5 } });
  await db.collection("orders").insertOne({
    _id: orderId, subtotal: d128("200.00"), discount: d128("0.00"), tax: d128("28.00"), total: d128("288.00"), refundedTotal: d128("0.30"),
    fulfilment: { fee: d128("60.00") }, payment: { refund: { amount: d128("0.30") } }, appliedPromotion: { value: d128("12.50") },
    invoiceSnapshot: { tax: { rate: 14 } }, updatedAt: new Date("2026-02-02"),
  });
  await db.collection("orderlines").insertOne({ _id: new ObjectId(), orderId, unitPrice: d128("100.00"), lineTotal: d128("200.00"), lineDiscount: d128("0.00"), quantity: 2 });
  await db.collection("activitylogs").insertOne({ _id: new ObjectId(), changes: { legacyAmount: d128("9.99") } }); // NOT a money field
}

beforeAll(async () => {
  client = await MongoClient.connect(URI);
  db = client.db(DB_NAME);
});
afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});
beforeEach(seed);

describe("the field list", () => {
  it("is exactly the money paths the schemas declare — no money field missed, nothing extra converted", () => {
    const fromSchemas = {};
    for (const model of ALL_MODELS) {
      const paths = moneyPaths(model.schema);
      if (paths.length) fromSchemas[model.collection.collectionName] = [...paths].sort();
    }
    const fromScript = Object.fromEntries(Object.entries(MONEY_FIELDS).map(([name, fields]) => [name, [...fields].sort()]));
    expect(fromScript).toEqual(fromSchemas);
  });
});

describe("valueProblem", () => {
  it("accepts what the application writes", () => {
    for (const value of [d128("19.99"), d128("150"), d128("19.990"), d128("0.00"), new Double(560), new Double(0.1), new Int32(80)]) expect(valueProblem(value)).toBeNull();
  });
  it("refuses anything it cannot convert exactly", () => {
    expect(valueProblem(d128("1.005"))).toMatch(/more than two decimal places/);
    expect(valueProblem(d128("-1.00"))).toBe("negative");
    expect(valueProblem(d128("NaN"))).toMatch(/not a finite number/);
    expect(valueProblem(d128("Infinity"))).toMatch(/not a finite number/);
    expect(valueProblem(d128("10000000000000.00"))).toMatch(/too large/);
    expect(valueProblem("560.00")).toMatch(/unsupported type string/);
    expect(valueProblem({ amount: 1 })).toMatch(/unsupported type object/);
  });
});

describe("dry run (the default) and the audit", () => {
  it("writes nothing", async () => {
    const before = canonical(await db.collection("variants").find().sort({ _id: 1 }).toArray());
    const plan = await migrate(db, { execute: false });
    expect(canonical(await db.collection("variants").find().sort({ _id: 1 }).toArray())).toBe(before);
    // Candidates are the numeric non-double values: A, B, C, E (Decimal128) and G (Int32). C and E are invalid; the
    // string D is never a candidate; F is already a double.
    expect(plan.fields["variants.price"]).toMatchObject({ candidates: 5, converted: 3, invalid: 2 });
  });

  it("reports types, invalid values, fingerprints, and Decimal128 outside the money fields", async () => {
    const report = await audit(db);
    const price = report.collections.variants.fields.price;
    expect(price.types).toEqual({ decimal: 4, double: 1, int: 1, string: 1 });
    expect(price.problems.map((p) => p.problem).sort()).toEqual(["more than two decimal places (12.345)", "negative", "unsupported type string"]);
    expect(report.collections.orders.fields.total.fingerprint).toEqual({ count: 1, sum: "288" });
    expect(report.unlistedDecimal128).toEqual({ "activitylogs.changes.legacyAmount": 1 });
  });
});

describe("execute", () => {
  it("converts every valid money value to BSON Double with the same amount, and touches nothing else", async () => {
    const before = await audit(db);
    const logFile = path.join(mkdtempSync(path.join(os.tmpdir(), "money-")), "log.jsonl");
    await migrate(db, { execute: true, logFile });
    const after = await audit(db, { scanUnlisted: false });

    // Amounts: identical counts and exact sums on every field.
    for (const [name, entry] of Object.entries(before.collections)) for (const [field, info] of Object.entries(entry.fields)) expect(after.collections[name].fields[field].fingerprint).toEqual(info.fingerprint);

    const order = await db.collection("orders").findOne({}, { promoteValues: false });
    for (const field of ["subtotal", "discount", "tax", "total", "refundedTotal"]) expect(bsonType(order[field])).toBe("double");
    expect(bsonType(order.fulfilment.fee)).toBe("double");
    expect(bsonType(order.payment.refund.amount)).toBe("double");
    expect(order.total.valueOf()).toBe(288);
    expect(order.refundedTotal.valueOf()).toBe(0.3);
    expect(order.appliedPromotion.value.valueOf()).toBe(12.5);
    // Not money: untouched, including updatedAt.
    expect(order.invoiceSnapshot.tax.rate.valueOf()).toBe(14);
    expect(order.updatedAt).toEqual(new Date("2026-02-02"));

    const variants = Object.fromEntries((await db.collection("variants").find({}, { promoteValues: false }).toArray()).map((v) => [v.sku, v]));
    expect(bsonType(variants.A.price)).toBe("double");
    expect(variants.A.price.valueOf()).toBe(560);
    expect(variants.A.costPrice.valueOf()).toBe(19.99);
    expect(variants.B.price.valueOf()).toBe(0.1);
    expect(bsonType(variants.G.price)).toBe("double"); // the stray Int32 is now a double
    expect(variants.A.weight.valueOf()).toBe(1.25);
    // Invalid values: exactly as they were.
    expect(variants.C.price.toString()).toBe("12.345");
    expect(variants.D.price).toBe("560.00");
    expect(variants.E.price.toString()).toBe("-5.00");
    // A Decimal128 outside the money fields: untouched.
    expect(bsonType((await db.collection("activitylogs").findOne({}, { promoteValues: false })).changes.legacyAmount)).toBe("decimal");

    // The change log records every change, old and new, and nothing else.
    const log = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(log.find((e) => e.collection === "variants" && e.field === "costPrice")).toMatchObject({ from: { type: "decimal", value: "19.99" }, to: { type: "double", value: "19.99" } });
    expect(log).toHaveLength(after.totals.double - 1); // every double now present, minus variant F, which was already one
    expect((await verify(db, log)).ok).toBe(true);
  });

  it("is idempotent: a second run converts nothing and changes no byte", async () => {
    await migrate(db, { execute: true });
    const once = canonical(await Promise.all(Object.keys(MONEY_FIELDS).map((name) => db.collection(name).find().sort({ _id: 1 }).toArray())));
    const second = await migrate(db, { execute: true });
    expect(second.converted).toBe(0);
    expect(canonical(await Promise.all(Object.keys(MONEY_FIELDS).map((name) => db.collection(name).find().sort({ _id: 1 }).toArray())))).toBe(once);
  });

  it("never overwrites a value the shop changed after it was read", async () => {
    // The update matches on the value it read: simulate the shop changing the price between read and write.
    const variant = await db.collection("variants").findOne({ sku: "A" }, { promoteValues: false });
    await db.collection("variants").updateOne({ _id: variant._id }, { $set: { price: d128("570.00") } });
    const result = await db.collection("variants").updateOne({ _id: variant._id, price: { $eq: variant.price, $type: "decimal" } }, { $set: { price: new Double(560) } });
    expect(result.modifiedCount).toBe(0);
    expect((await db.collection("variants").findOne({ _id: variant._id }, { promoteValues: false })).price.toString()).toBe("570.00");
  });

  it("verify reports a converted value that no longer matches the log, and fails when one reverts to Decimal128", async () => {
    const logFile = path.join(mkdtempSync(path.join(os.tmpdir(), "money-")), "log.jsonl");
    await migrate(db, { execute: true, logFile });
    const log = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    await db.collection("orders").updateOne({}, { $set: { total: new Double(289) } });
    const edited = await verify(db, log);
    expect(edited.notes.join(" ")).toMatch(/orders .* total: holds 289, the migration wrote 288/);
    await db.collection("orders").updateOne({}, { $set: { total: d128("288.00") } });
    const reverted = await verify(db, log);
    expect(reverted.ok).toBe(false);
    expect(reverted.problems.join(" ")).toMatch(/total: now holds decimal, expected double/);
  });
});

describe("reverse", () => {
  it("restores every converted value to Decimal128 — the original bytes, exactly", async () => {
    const original = canonical(await Promise.all(["variants", "products", "orders", "orderlines"].map((name) => db.collection(name).find({ sku: { $nin: ["F", "G"] } }).sort({ _id: 1 }).toArray())));
    await migrate(db, { execute: true });
    const reversed = await migrate(db, { direction: "reverse", execute: true });
    expect(reversed.converted).toBeGreaterThan(0);
    expect(canonical(await Promise.all(["variants", "products", "orders", "orderlines"].map((name) => db.collection(name).find({ sku: { $nin: ["F", "G"] } }).sort({ _id: 1 }).toArray())))).toBe(original);
    expect((await verify(db, [], { direction: "reverse" })).ok).toBe(true);
  });

  it("a reverse dry run writes nothing", async () => {
    await migrate(db, { execute: true });
    const before = canonical(await db.collection("orders").find().toArray());
    const plan = await migrate(db, { direction: "reverse", execute: false });
    expect(plan.converted).toBeGreaterThan(0);
    expect(canonical(await db.collection("orders").find().toArray())).toBe(before);
  });
});

describe("review hardening", () => {
  it("logs typed ids, so string, hex-looking string and numeric _ids all verify", async () => {
    await db.collection("variants").insertMany([
      { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", sku: "HEXSTRING", price: d128("11.00") }, // a string that looks like an ObjectId
      { _id: "plain-id", sku: "STRING", price: d128("12.00") },
      { _id: 42, sku: "NUMBER", price: d128("13.00") },
    ]);
    const logFile = path.join(mkdtempSync(path.join(os.tmpdir(), "money-")), "log.jsonl");
    await migrate(db, { execute: true, logFile });
    const log = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(log.filter((e) => ["aaaaaaaaaaaaaaaaaaaaaaaa", "plain-id", "42"].includes(e._id)).map((e) => e.id).sort()).toEqual(['"aaaaaaaaaaaaaaaaaaaaaaaa"', '"plain-id"', '{"$numberInt":"42"}']);
    const result = await verify(db, log);
    expect(result).toMatchObject({ ok: true, notes: [] });
  });

  it("verify fails when a converted field no longer holds the expected type, and only notes a later shop edit", async () => {
    const logFile = path.join(mkdtempSync(path.join(os.tmpdir(), "money-")), "log.jsonl");
    await migrate(db, { execute: true, logFile });
    const log = readFileSync(logFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    await db.collection("variants").updateOne({ sku: "A" }, { $set: { price: new Double(570) } }); // a normal later edit
    const edited = await verify(db, log);
    expect(edited.ok).toBe(true);
    expect(edited.notes.join(" ")).toMatch(/holds 570, the migration wrote 560 — changed by the shop since/);
    await db.collection("variants").updateOne({ sku: "B" }, { $set: { price: "0.10" } }); // the wrong type
    const broken = await verify(db, log);
    expect(broken.ok).toBe(false);
    expect(broken.problems.join(" ")).toMatch(/price: now holds string, expected double/);
  });

  it("the compare-and-set never overwrites an array that merely contains the old value", async () => {
    const variant = await db.collection("variants").findOne({ sku: "A" }, { promoteValues: false });
    await db.collection("variants").updateOne({ _id: variant._id }, { $set: { price: [variant.price, d128("1.00")] } });
    const result = await db.collection("variants").updateOne(compareAndSetFilter(variant._id, "price", variant.price), { $set: { price: new Double(560) } });
    expect(result.modifiedCount).toBe(0);
    expect(Array.isArray((await db.collection("variants").findOne({ _id: variant._id })).price)).toBe(true);
    // ...while the scalar it was read as is matched exactly.
    await db.collection("variants").updateOne({ _id: variant._id }, { $set: { price: variant.price } });
    expect((await db.collection("variants").updateOne(compareAndSetFilter(variant._id, "price", variant.price), { $set: { price: new Double(560) } })).modifiedCount).toBe(1);
  });
});

describe("CLI refusals (before anything is written)", () => {
  const cli = (args, extraEnv = {}) =>
    spawnSync(process.execPath, [path.join(import.meta.dirname, "money-to-double.mjs"), ...args], { encoding: "utf8", env: { ...process.env, MONGODB_URI: URI, MONGODB_DB: DB_NAME, ...extraEnv }, timeout: 30_000 });

  it("refuses --dry-run together with --execute", () => {
    const run = cli(["--dry-run", "--execute", `--confirm-db=${DB_NAME}`]);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/--dry-run and --execute contradict each other/);
  });

  it("refuses an execute without the exact database name", () => {
    expect(cli(["--execute"]).stderr).toMatch(/needs --confirm-db/);
    expect(cli(["--execute", "--confirm-db=some-other-db"]).stderr).toMatch(/needs --confirm-db/);
  });

  it("refuses to write to a database with no store-identity marker, even on localhost — and writes nothing", async () => {
    const before = canonical(await db.collection("variants").find().sort({ _id: 1 }).toArray());
    const run = cli(["--execute", `--confirm-db=${DB_NAME}`]);
    expect(run.stderr).toMatch(/no store-identity marker naming mimora; refusing to write/);
    expect(canonical(await db.collection("variants").find().sort({ _id: 1 }).toArray())).toBe(before);
  });

  it("refuses a database that identifies as another store, even for a dry run", async () => {
    await db.collection("storeidentity").insertOne({ _id: "store-identity", storeId: "someone-else" });
    expect(cli([]).stderr).toMatch(/identifies as store "someone-else", not mimora/);
  });

  it("ignores a marker that is not the canonical document", async () => {
    await db.collection("storeidentity").insertOne({ _id: "not-the-marker", storeId: "mimora" });
    expect(cli(["--execute", `--confirm-db=${DB_NAME}`]).stderr).toMatch(/no store-identity marker naming mimora/);
  });

  it("with the mimora marker, an execute converts and exits 0", async () => {
    await db.collection("storeidentity").insertOne({ _id: "store-identity", storeId: "mimora" });
    const run = cli(["--execute", `--confirm-db=${DB_NAME}`, `--log-dir=${mkdtempSync(path.join(os.tmpdir(), "money-cli-"))}`]);
    expect(run.stdout).toMatch(/Fingerprints identical before and after/);
    expect(run.stdout).toMatch(/Verify: OK/);
    expect(run.status).toBe(0);
  });
});
