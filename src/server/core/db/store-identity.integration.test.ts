import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import mongoose from "mongoose";
import { MongoClient, type Db } from "mongodb";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADOPTED_VIA,
  adoptStoreIdentity,
  assertConfirmed,
  assertStoreId,
  MARKER_COLLECTION,
  MARKER_ID,
  parseArgs,
  PREFLIGHT_COLLECTIONS,
  preflight,
  resolveTarget,
  STORE_ID_PATTERN as SCRIPT_STORE_ID_PATTERN,
  StoreIdentityRefusal,
} from "../../../../scripts/admin/store-identity-core.mjs";
import { OrderModel } from "../../commerce/order.schema";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { ProductModel } from "../../catalog/product.schema";
import { connectToDatabase } from "./connect";
import { assertStoreIdentity, configuredStoreId, STORE_ID_PATTERN, STORE_IDENTITY_COLLECTION, STORE_IDENTITY_DOC_ID, storeIdentityEnforced } from "./store-identity";

/*
 * The store-identity guard, against a real replica set. One database per suite (`store-platform-staff-test-sid-*`,
 * dropped before use); the suite that drives `connectToDatabase` points the process at its own database and resets the
 * connection cache between tests, which is what a fresh process would have.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";
process.env.CUSTOMER_JWT_SECRET ??= "test-customer-secret-at-least-32-characters-long";

const URI = process.env.MONGODB_URI;
const DB_PREFIX = "store-platform-staff-test-sid";
const run = promisify(execFile);
const REPO = path.resolve(__dirname, "../../../..");
const CLI = path.join(REPO, "scripts/admin/adopt-store-identity.mjs");

let client: MongoClient;
beforeAll(async () => {
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
});
afterAll(async () => {
  await client.close();
});

/** A fresh, empty database for one suite or test. */
async function freshDb(suffix: string): Promise<Db> {
  const db = client.db(`${DB_PREFIX}-${suffix}`);
  await db.dropDatabase();
  return db;
}
const markerOf = (db: Db) => db.collection(MARKER_COLLECTION).findOne({ _id: MARKER_ID as never });
const adopt = (db: Db, storeId: string, extra: Record<string, unknown> = {}) => adoptStoreIdentity(db, { storeId, confirmDb: db.databaseName, ...extra });

const cacheOf = () => (globalThis as unknown as { __storePlatformStaffMongoose: { connection: unknown; promise: unknown } }).__storePlatformStaffMongoose;
/** What a fresh process has: no cached connection, no memoised promise, the given database and STORE_ID. */
async function freshProcess(dbName: string, storeId: string | undefined) {
  await mongoose.disconnect();
  cacheOf().connection = null;
  cacheOf().promise = null;
  vi.stubEnv("MONGODB_DB", dbName);
  vi.stubEnv("STORE_ID", storeId ?? "");
}

describe("the CLI's copies of application values cannot drift", () => {
  it("collection name, marker _id and slug pattern match the runtime guard; preflight collections match the models", () => {
    expect(MARKER_COLLECTION).toBe(STORE_IDENTITY_COLLECTION);
    expect(MARKER_ID).toBe(STORE_IDENTITY_DOC_ID);
    expect(SCRIPT_STORE_ID_PATTERN.source).toBe(STORE_ID_PATTERN.source);
    expect(SCRIPT_STORE_ID_PATTERN.flags).toBe(STORE_ID_PATTERN.flags);
    expect(PREFLIGHT_COLLECTIONS).toEqual({
      profile: StoreProfileModel.collection.name,
      products: ProductModel.collection.name,
      orders: OrderModel.collection.name,
      customers: CustomerModel.collection.name,
    });
  });

  it("the slug rule accepts short stable slugs and nothing else", () => {
    for (const ok of ["mimora", "hirfa", "qahwa", "a", "ab", "store-1", "a".repeat(40)]) {
      expect(STORE_ID_PATTERN.test(ok), ok).toBe(true);
      expect(() => assertStoreId(ok)).not.toThrow();
    }
    for (const bad of ["", "Hirfa", "-a", "a-", "a b", "a_b", "a.b", "a".repeat(41), "مطعم", "a\nb"]) {
      expect(STORE_ID_PATTERN.test(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(() => assertStoreId("Hirfa")).toThrow(StoreIdentityRefusal);
    expect(() => assertStoreId(undefined)).toThrow(/--store-id is required/);
  });
});

describe("adopting a database (the CLI core)", () => {
  it("initialises an EMPTY database: one marker with the id, a date and the script path", async () => {
    const db = await freshDb("empty");
    const now = new Date("2026-10-26T09:00:00Z");
    const result = await adopt(db, "hirfa", { now });
    expect(result.action).toBe("adopted");
    expect(await markerOf(db)).toEqual({ _id: MARKER_ID, storeId: "hirfa", adoptedAt: now, adoptedVia: ADOPTED_VIA });
    expect(await db.collection(MARKER_COLLECTION).countDocuments({})).toBe(1);
    expect((await db.listCollections().toArray()).map((c) => c.name)).toEqual([MARKER_COLLECTION]); // touched nothing else
  });

  it("initialises a database WITH data and leaves every existing document and count unchanged", async () => {
    const db = await freshDb("data");
    await db.collection("products").insertMany([{ slug: "a", n: 1 }, { slug: "b", n: 2 }]);
    await db.collection("orders").insertOne({ number: "0001", total: "10.00" });
    await db.collection("customers").insertOne({ phone: "+201000000001" });
    await db.collection("storeprofiles").insertOne({ name: { en: "Hirfa", ar: "حرفة" }, currency: "EGP" });
    const snapshot = async () => {
      const names = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => n !== MARKER_COLLECTION).sort();
      return Promise.all(names.map(async (n) => [n, await db.collection(n).find({}).sort({ _id: 1 }).toArray()] as const));
    };
    const before = await snapshot();

    await adopt(db, "hirfa");

    expect(await snapshot()).toEqual(before);
    expect(await db.collection("products").countDocuments({})).toBe(2);
    expect(await db.collection("orders").findOne({ number: "0001" })).toMatchObject({ total: "10.00" });
    expect((await markerOf(db))?.storeId).toBe("hirfa");
  });

  it("a repeat with the same id is idempotent: adoptedAt and adoptedVia never move", async () => {
    const db = await freshDb("repeat");
    await adopt(db, "hirfa", { now: new Date("2026-10-26T09:00:00Z") });
    const first = await markerOf(db);
    const again = await adopt(db, "hirfa", { now: new Date("2027-01-01T00:00:00Z"), via: "something-else" });
    expect(again.action).toBe("already-adopted");
    expect(await markerOf(db)).toEqual(first);
  });

  it("never overwrites a marker for another store: refuses, and the marker is byte-for-byte unchanged", async () => {
    const db = await freshDb("other");
    await adopt(db, "hirfa");
    const before = await markerOf(db);
    await expect(adopt(db, "qahwa")).rejects.toThrow(/belongs to store 'hirfa', so it cannot be adopted as 'qahwa'/);
    await expect(adopt(db, "qahwa", { dryRun: true })).rejects.toBeInstanceOf(StoreIdentityRefusal);
    expect(await markerOf(db)).toEqual(before);
  });

  it("CONCURRENT, same id: eight parallel adopts all succeed and leave one marker", async () => {
    for (let round = 0; round < 3; round++) {
      const db = await freshDb("race-same");
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => adopt(db, "hirfa")));
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const actions = results.map((r) => (r as PromiseFulfilledResult<{ action: string }>).value.action);
      expect(actions.filter((a) => a === "adopted")).toHaveLength(1); // exactly one inserted
      expect(await db.collection(MARKER_COLLECTION).countDocuments({})).toBe(1);
      expect((await markerOf(db))?.storeId).toBe("hirfa");
    }
  });

  it("CONCURRENT, different ids: exactly one wins, every other is refused, the marker holds the winner", async () => {
    for (let round = 0; round < 3; round++) {
      const db = await freshDb("race-diff");
      const ids = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
      const results = await Promise.allSettled(ids.map((id) => adopt(db, id)));
      const won = results.map((r, i) => ({ r, id: ids[i]! })).filter(({ r }) => r.status === "fulfilled");
      expect(won).toHaveLength(1);
      for (const r of results.filter((r): r is PromiseRejectedResult => r.status === "rejected")) expect(r.reason).toBeInstanceOf(StoreIdentityRefusal);
      expect(await db.collection(MARKER_COLLECTION).countDocuments({})).toBe(1);
      expect((await markerOf(db))?.storeId).toBe(won[0]!.id);
    }
  });

  it("--confirm-db must equal the database name exactly; a mismatch or a missing value refuses and writes nothing", async () => {
    const db = await freshDb("confirm");
    for (const confirmDb of [undefined, "", `${db.databaseName}-x`, db.databaseName.toUpperCase(), ` ${db.databaseName}`]) {
      await expect(adoptStoreIdentity(db, { storeId: "hirfa", confirmDb: confirmDb as string })).rejects.toBeInstanceOf(StoreIdentityRefusal);
    }
    expect(() => assertConfirmed("x-dev", "x-dev")).not.toThrow(); // local names need no less than production ones
    expect(() => assertConfirmed("x-dev", undefined)).toThrow(/--confirm-db is required/);
    expect(await markerOf(db)).toBeNull();
    expect(await db.listCollections().toArray()).toHaveLength(0);
  });

  it("an invalid store id refuses before anything is written", async () => {
    const db = await freshDb("badid");
    await expect(adopt(db, "Not A Slug")).rejects.toBeInstanceOf(StoreIdentityRefusal);
    expect(await markerOf(db)).toBeNull();
  });

  it("a dry run writes nothing at all, on an empty database and on one with data", async () => {
    const db = await freshDb("dry");
    await db.collection("products").insertOne({ slug: "a" });
    const result = await adopt(db, "hirfa", { dryRun: true });
    expect(result.action).toBe("would-adopt");
    expect(await markerOf(db)).toBeNull();
    expect((await db.listCollections().toArray()).map((c) => c.name)).toEqual(["products"]);
  });

  it("preflight shows the marker, the store's names and currency, and the counts — reading only", async () => {
    const db = await freshDb("preflight");
    expect(await preflight(db)).toEqual({ dbName: db.databaseName, marker: null, profile: null, counts: { products: 0, orders: 0, customers: 0 } });
    await db.collection("storeprofiles").insertOne({ name: { en: "Hirfa", ar: "حرفة" }, currency: "EGP", secret: "x" });
    await db.collection("products").insertMany([{ a: 1 }, { a: 2 }, { a: 3 }]);
    await db.collection("orders").insertOne({ a: 1 });
    await adopt(db, "hirfa");
    const seen = await preflight(db);
    expect(seen).toMatchObject({ marker: { storeId: "hirfa", adoptedVia: ADOPTED_VIA }, profile: { nameEn: "Hirfa", nameAr: "حرفة", currency: "EGP" }, counts: { products: 3, orders: 1, customers: 0 } });
    expect(JSON.stringify(seen)).not.toContain("secret");
  });

  it("a target is described by hosts only, never credentials", () => {
    const target = resolveTarget("mongodb+srv://admin:s3cret-pass@cluster0.example.mongodb.net/?retryWrites=true", "prod");
    expect(JSON.stringify(target)).not.toContain("s3cret");
    expect(target.hosts).toEqual(["cluster0.example.mongodb.net"]);
    expect(() => resolveTarget("mongodb://localhost:27020", undefined)).toThrow(/MONGODB_DB is required/);
  });
});

describe("command-line arguments", () => {
  it("accepts --key value and --key=value, and the bare --dry-run", () => {
    expect(parseArgs(["--store-id", "hirfa", "--confirm-db=db-x", "--dry-run"])).toEqual({ "store-id": "hirfa", "confirm-db": "db-x", "dry-run": true });
    expect(parseArgs(["--store-id=hirfa", "--confirm-db", "db-x"])).toEqual({ "store-id": "hirfa", "confirm-db": "db-x" });
  });

  it("refuses a missing value, an unknown or mistyped option, a value on a flag, and stray words", () => {
    expect(() => parseArgs(["--store-id"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--store-id", "--dry-run"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--confirm-bd=x"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--force"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--dry-run=yes"])).toThrow(/takes no value/);
    expect(() => parseArgs(["hirfa"])).toThrow(/Unexpected argument/);
  });
});

describe("the command itself (a real process)", () => {
  const cli = (args: string[], env: Record<string, string | undefined>) =>
    run(process.execPath, [CLI, ...args], { env: { ...process.env, MONGODB_URI: URI, ...env }, cwd: REPO }).then(
      (out) => ({ code: 0, out: out.stdout, err: out.stderr }),
      (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, out: error.stdout, err: error.stderr })
    );

  it("prints the preflight, adopts (exit 0), repeats idempotently (exit 0), and refuses another id (exit 1)", async () => {
    const db = await freshDb("cli");
    await db.collection("storeprofiles").insertOne({ name: { en: "Hirfa", ar: "حرفة" }, currency: "EGP" });
    await db.collection("products").insertMany([{ a: 1 }, { a: 2 }]);
    const env = { MONGODB_DB: db.databaseName };

    const dry = await cli(["--store-id", "hirfa", "--confirm-db", db.databaseName, "--dry-run"], env);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(db.databaseName);
    expect(dry.out).toContain(new URL(URI.replace(/^mongodb:/, "http:")).hostname); // the host, not the credentials
    expect(dry.out).toContain("Hirfa / حرفة, currency EGP");
    expect(dry.out).toContain("2 products, 0 orders, 0 customers");
    expect(dry.out).toMatch(/Nothing was written/);
    expect(await markerOf(db)).toBeNull();

    const real = await cli([`--store-id=hirfa`, `--confirm-db=${db.databaseName}`], env);
    expect(real.code).toBe(0);
    expect(real.out).toMatch(/Adopted .* as store 'hirfa'/);
    const first = await markerOf(db);
    expect(first?.storeId).toBe("hirfa");

    const repeat = await cli(["--store-id", "hirfa", "--confirm-db", db.databaseName], env);
    expect(repeat.code).toBe(0);
    expect(repeat.out).toMatch(/already adopted as store 'hirfa'. Nothing changed/);
    expect(await markerOf(db)).toEqual(first);

    const other = await cli(["--store-id", "qahwa", "--confirm-db", db.databaseName], env);
    expect(other.code).toBe(1);
    expect(other.err).toMatch(/^refused: database .* belongs to store 'hirfa'/);
    expect(await markerOf(db)).toEqual(first);
  }, 30_000);

  it("refuses (exit 1, nothing written) on a --confirm-db mismatch, a missing --confirm-db, a bad id and an unknown option", async () => {
    const db = await freshDb("cli-refuse");
    const env = { MONGODB_DB: db.databaseName };
    for (const args of [
      ["--store-id", "hirfa", "--confirm-db", "someone-else"],
      ["--store-id", "hirfa"],
      ["--store-id", "Hirfa!", "--confirm-db", db.databaseName],
      ["--store-id", "hirfa", "--confirm-db", db.databaseName, "--force"],
    ]) {
      const result = await cli(args, env);
      expect(result.code, args.join(" ")).toBe(1);
      expect(result.err).toMatch(/^refused: /);
    }
    expect((await cli(["--store-id", "hirfa", "--confirm-db", db.databaseName], { MONGODB_DB: undefined })).err).toMatch(/refused: MONGODB_DB is required/);
    expect(await markerOf(db)).toBeNull();
    expect(await db.listCollections().toArray()).toHaveLength(0);
  }, 30_000);

  it("never prints the connection credentials", async () => {
    const db = await freshDb("cli-secret");
    const uri = URI.replace("mongodb://", "mongodb://nobody:Sup3rSecretPw@");
    const result = await cli(["--store-id", "hirfa", "--confirm-db", db.databaseName, "--dry-run"], { MONGODB_URI: uri, MONGODB_DB: db.databaseName });
    expect(result.out + result.err).not.toContain("Sup3rSecretPw"); // auth fails against the unauthenticated test node or is ignored; either way, no echo
  }, 30_000);
});

describe("the runtime guard, as connectToDatabase applies it", () => {
  let db: Db;
  beforeAll(async () => {
    db = await freshDb("guard");
    await connectToDatabase().catch(() => undefined); // make sure the cache object exists on globalThis
  });
  beforeEach(async () => {
    await db.dropDatabase();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    cacheOf().connection = null;
    cacheOf().promise = null;
    await mongoose.disconnect();
  });

  it("connects when the marker names the configured store, and the marker is untouched", async () => {
    await adopt(db, "hirfa");
    const before = await markerOf(db);
    await freshProcess(db.databaseName, "hirfa");
    await expect(connectToDatabase()).resolves.toBe(mongoose);
    expect(await markerOf(db)).toEqual(before);
  });

  it("is checked once per process: a second call neither re-reads nor re-fails", async () => {
    await adopt(db, "hirfa");
    await freshProcess(db.databaseName, "hirfa");
    await connectToDatabase();
    await db.collection(MARKER_COLLECTION).deleteMany({}); // would refuse if it were checked again
    await expect(connectToDatabase()).resolves.toBe(mongoose);
  });

  it("REFUSES a marker for another store, says so, and leaves the marker unchanged", async () => {
    await adopt(db, "qahwa");
    const before = await markerOf(db);
    await freshProcess(db.databaseName, "hirfa");
    await expect(connectToDatabase()).rejects.toThrow(`database ${db.databaseName} belongs to store 'qahwa', this deployment is configured as 'hirfa'`);
    expect(await markerOf(db)).toEqual(before);
  });

  it("REFUSES an unmarked database at normal startup, names the adoption command, and does NOT create a marker", async () => {
    await db.collection("products").insertOne({ slug: "a" }); // data, but no marker
    await freshProcess(db.databaseName, "hirfa");
    const error = await connectToDatabase().then(() => null, (e: Error) => e);
    expect(error?.message).toContain(`Database ${db.databaseName} has no store-identity marker`);
    expect(error?.message).toContain(`scripts/admin/adopt-store-identity.mjs --store-id hirfa --confirm-db ${db.databaseName}`);
    expect(await markerOf(db)).toBeNull();
    expect(await db.collection(MARKER_COLLECTION).countDocuments({})).toBe(0);
    // Nothing at all was written: the guard runs before ensureIndexes, so a refused start creates no collection
    // or index in a database that may be another store's.
    expect((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)).toEqual(["products"]);
    expect((await db.collection("products").indexes()).map((index) => index.name)).toEqual(["_id_"]);
  });

  it("refuses a missing or malformed STORE_ID wherever the guard is enforced, and creates no marker", async () => {
    await adopt(db, "hirfa");
    vi.stubEnv("NODE_ENV", "development"); // not the test runner: enforced even though STORE_ID is unset
    await freshProcess(db.databaseName, undefined);
    await expect(connectToDatabase()).rejects.toThrow(/STORE_ID is not set/);
    await freshProcess(db.databaseName, "Hirfa Store");
    await expect(connectToDatabase()).rejects.toThrow(/STORE_ID "Hirfa Store" is not a valid store id/);
    await db.dropDatabase();
    await freshProcess(db.databaseName, undefined);
    await expect(connectToDatabase()).rejects.toThrow(/STORE_ID is not set/);
    expect(await markerOf(db)).toBeNull();
  });

  it("enforcement is off ONLY for NODE_ENV=test with STORE_ID unset; in the test runner a STORE_ID switches it on", async () => {
    expect(storeIdentityEnforced({ NODE_ENV: "test" })).toBe(false);
    expect(storeIdentityEnforced({ NODE_ENV: "test", STORE_ID: "  " })).toBe(false);
    expect(storeIdentityEnforced({ NODE_ENV: "test", STORE_ID: "hirfa" })).toBe(true);
    for (const nodeEnv of ["development", "production", undefined]) expect(storeIdentityEnforced({ NODE_ENV: nodeEnv }), String(nodeEnv)).toBe(true);
    // And the real thing: an unmarked database connects under the exception…
    await freshProcess(db.databaseName, undefined);
    await expect(connectToDatabase()).resolves.toBe(mongoose);
    // …and is refused the moment STORE_ID is set.
    await freshProcess(db.databaseName, "hirfa");
    await expect(connectToDatabase()).rejects.toThrow(/no store-identity marker/);
  });

  it("a failed start clears the memo: once the operator adopts the database, the same process recovers", async () => {
    await freshProcess(db.databaseName, "hirfa");
    await expect(connectToDatabase()).rejects.toThrow(/no store-identity marker/);
    await adopt(db, "hirfa");
    await expect(connectToDatabase()).resolves.toBe(mongoose);
  });

  it("never puts the connection string or its credentials in a refusal", async () => {
    await freshProcess(db.databaseName, "hirfa");
    const error = await connectToDatabase().then(() => null, (e: Error) => e);
    expect(error?.message).not.toContain("mongodb://");
    expect(error?.message).not.toContain(String(URI).split("@")[0]);
  });

  it("assertStoreIdentity refuses a corrupt marker without repairing it", async () => {
    await db.collection(MARKER_COLLECTION).insertOne({ _id: MARKER_ID as never, storeId: 42 as never });
    await expect(assertStoreIdentity(db, { STORE_ID: "hirfa", NODE_ENV: "production" })).rejects.toThrow(/malformed/);
    expect(await markerOf(db)).toEqual({ _id: MARKER_ID, storeId: 42 });
  });

  it("configuredStoreId validates, trims, and refuses blanks", () => {
    expect(configuredStoreId({ STORE_ID: " hirfa " })).toBe("hirfa");
    expect(() => configuredStoreId({})).toThrow(/not set/);
    expect(() => configuredStoreId({ STORE_ID: "   " })).toThrow(/not set/);
    expect(() => configuredStoreId({ STORE_ID: "-x" })).toThrow(/not a valid store id/);
  });
});

describe("GET /api/storefront/identity", () => {
  type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
  let route: Handler;
  let db: Db;
  const call = () => route(new NextRequest("http://localhost/api/storefront/identity"), { params: Promise.resolve({}) });

  beforeAll(async () => {
    route = (await import("../../../app/api/storefront/identity/route")).GET as unknown as Handler;
    db = await freshDb("route");
  });
  beforeEach(async () => {
    await db.dropDatabase();
    await freshProcess(db.databaseName, "hirfa");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    cacheOf().connection = null;
    cacheOf().promise = null;
    await mongoose.disconnect();
  });

  it("returns the configured STORE_ID, publicly (no credentials), once the marker is verified", async () => {
    await adopt(db, "hirfa");
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ storeId: "hirfa" });
  });

  it("goes through the guard: with a mismatched or missing marker it answers a generic 500 — never the store id, the database name or the refusal text", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await adopt(db, "qahwa");
    const mismatched = await call();
    expect(mismatched.status).toBe(500);
    const text = JSON.stringify(await mismatched.json());
    for (const secret of ["hirfa", "qahwa", db.databaseName, "marker"]) expect(text).not.toContain(secret);
    expect(String(logged.mock.calls[0]?.[0])).toContain("belongs to store 'qahwa', this deployment is configured as 'hirfa'"); // the operator's log has it

    await db.dropDatabase();
    await freshProcess(db.databaseName, "hirfa"); // reconnect, so the indexes are rebuilt and the ONLY thing missing is the marker
    logged.mockClear();
    expect((await call()).status).toBe(500);
    expect(String(logged.mock.calls[0]?.[0])).toContain("has no store-identity marker");
  });

  it("is declared public and force-dynamic, in the storefront group", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(path.join(REPO, "src/app/api/storefront/identity/route.ts"), "utf8");
    expect(source).toMatch(/auth:\s*false/);
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).not.toMatch(/revalidateTags:/);
  });
});
