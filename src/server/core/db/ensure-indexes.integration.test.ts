// @vitest-environment node
import mongoose, { Schema, type Model } from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "./connect";
import { ensureIndexes } from "./ensure-indexes";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

/**
 * ensureIndexes against a real database, on throwaway models covering every index shape the application declares:
 * single-field unique, sparse unique, TTL, partial-filter unique, and a compound index whose field order matters.
 * Only missing indexes are built; existing ones are left exactly as they are; a conflict refuses startup without
 * dropping anything.
 */
const suffix = new mongoose.Types.ObjectId().toString();
const collectionName = `zz_index_probe_${suffix}`;

function probeSchema() {
  const schema = new Schema({ sku: String, email: String, expiresAt: Date, code: String, status: String, tenant: String, at: Date }, { collection: collectionName, autoCreate: false, autoIndex: false });
  schema.index({ sku: 1 }, { unique: true });
  schema.index({ email: 1 }, { unique: true, sparse: true });
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  schema.index({ code: 1 }, { unique: true, partialFilterExpression: { status: "active" } });
  schema.index({ tenant: 1, at: -1 });
  return schema;
}

let modelCount = 0;
/** A fresh model on the same collection each time, so Mongoose's per-model memo never hides a database call. */
const probe = (): Model<never> => mongoose.model(`IndexProbe${suffix}_${modelCount++}`, probeSchema()) as unknown as Model<never>;

const stored = async () =>
  (await mongoose.connection.db!.collection(collectionName).indexes())
    .filter((index) => index.name !== "_id_")
    // Everything that describes the index, without the server-assigned version and namespace.
    .map((index) => Object.fromEntries(Object.entries(index).filter(([field]) => field !== "v" && field !== "ns")) as typeof index)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

beforeAll(connectToDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  await mongoose.connection.db!.collection(collectionName).drop().catch(() => undefined);
});
afterAll(() => mongoose.disconnect());

describe("ensureIndexes", () => {
  it("missing: builds every declared index with its exact options", async () => {
    await ensureIndexes([probe()]);

    const indexes = await stored();
    const byName = Object.fromEntries(indexes.map((index) => [index.name, index]));
    expect(Object.keys(byName).sort()).toEqual(["code_1", "email_1", "expiresAt_1", "sku_1", "tenant_1_at_-1"]);
    expect(byName.sku_1).toMatchObject({ key: { sku: 1 }, unique: true });
    expect(byName.email_1).toMatchObject({ key: { email: 1 }, unique: true, sparse: true });
    expect(byName.expiresAt_1).toMatchObject({ key: { expiresAt: 1 }, expireAfterSeconds: 0 });
    expect(byName.code_1).toMatchObject({ key: { code: 1 }, unique: true, partialFilterExpression: { status: "active" } });
    expect(byName["tenant_1_at_-1"]!.key).toEqual({ tenant: 1, at: -1 });
    expect(Object.keys(byName["tenant_1_at_-1"]!.key)).toEqual(["tenant", "at"]); // compound field order preserved
  });

  it("existing: an up-to-date collection gets no index build at all, and its indexes are untouched", async () => {
    await ensureIndexes([probe()]);
    const before = await stored();
    const model = probe();
    const createIndexes = vi.spyOn(model, "createIndexes");
    const createIndex = vi.spyOn(mongoose.connection.db!.collection(collectionName), "createIndex");

    await ensureIndexes([model]);

    expect(createIndexes).not.toHaveBeenCalled();
    expect(createIndex).not.toHaveBeenCalled();
    expect(await stored()).toEqual(before);
  });

  it("partly missing: only the absent index is built; the others are not recreated", async () => {
    await ensureIndexes([probe()]);
    await mongoose.connection.db!.collection(collectionName).dropIndex("email_1");
    const survivors = (await stored()).filter((index) => index.name !== "email_1");
    const model = probe();
    // Mongoose consumes the `toCreate` array as it builds, so record a copy of what it was asked to create.
    const requested: Array<Array<[Record<string, unknown>, Record<string, unknown>]>> = [];
    const original = model.createIndexes.bind(model);
    const createIndexes = vi.spyOn(model, "createIndexes").mockImplementation(((options: { toCreate: Array<[Record<string, unknown>, Record<string, unknown>]> }) => {
      requested.push(structuredClone(options.toCreate));
      return original(options as never);
    }) as never);

    await ensureIndexes([model]);

    expect(createIndexes).toHaveBeenCalledTimes(1);
    const toCreate = requested[0]!;
    expect(toCreate).toHaveLength(1);
    expect(toCreate[0]![0]).toEqual({ email: 1 });
    expect(toCreate[0]![1]).toMatchObject({ unique: true, sparse: true });
    const after = await stored();
    expect(after.find((index) => index.name === "email_1")).toMatchObject({ unique: true, sparse: true });
    expect(after.filter((index) => index.name !== "email_1")).toEqual(survivors);
  });

  it("conflict: an index with the declared key but the wrong options refuses startup and is NOT dropped", async () => {
    const collection = mongoose.connection.db!.collection(collectionName);
    await collection.createIndex({ sku: 1 }, { name: "sku_1" }); // same key and name, but NOT unique
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(ensureIndexes([probe()])).rejects.toThrow(/Refusing to start: .*declared index/);

    const sku = (await stored()).find((index) => index.name === "sku_1");
    expect(sku).toBeDefined();
    expect(sku!.unique).toBeUndefined(); // still the original index: nothing dropped, nothing replaced
    log.mockRestore();
  });

  it("a unique index that cannot be built over duplicate data refuses startup and names the model", async () => {
    await mongoose.connection.db!.collection(collectionName).insertMany([{ sku: "DUP" }, { sku: "DUP" }]);

    await expect(ensureIndexes([probe()])).rejects.toThrow(/IndexProbe.*index build failed/);
  });

  it("repeated startups are idempotent: the stored indexes never change after the first", async () => {
    await ensureIndexes([probe()]);
    const first = await stored();
    await ensureIndexes([probe()]);
    await ensureIndexes([probe()]);
    expect(await stored()).toEqual(first);
  });
});
