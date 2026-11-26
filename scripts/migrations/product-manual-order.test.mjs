import mongodb from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sortProductsManual } from "../../src/server/engines/product-order/product-order";
import { canonicalOrder, planRenumber, renumber, visibleOrder } from "./product-manual-order.mjs";

const { MongoClient, ObjectId } = mongodb;

/** The optional normalisation of `products.order` to 1..N: same order as the engine, no visible change, idempotent. */
const URI = "mongodb://localhost:27020/?replicaSet=rs0&directConnection=true";
const DB_NAME = `store-platform-staff-test-ordermig-${process.pid}-${Date.now()}`;
let client;
let db;

const product = (order, createdAt) => ({ _id: new ObjectId(), order, createdAt: new Date(createdAt) });

describe("canonicalOrder", () => {
  it("is the engine's order, including ties and missing order", () => {
    const rows = [
      product(0, "2026-01-01"), product(0, "2026-03-01"), product(2, "2026-02-01"), product(1, "2026-02-01"),
      { ...product(0, "2026-03-01"), createdAt: new Date("2026-03-01") }, { _id: new ObjectId(), createdAt: new Date("2026-02-15") },
    ];
    const asEngine = rows.map((row) => ({ id: row._id.toString(), order: row.order ?? 0, createdAt: row.createdAt }));
    expect(canonicalOrder(rows).map((row) => row._id.toString())).toEqual(sortProductsManual(asEngine).map((row) => row.id));
  });
});

describe("planRenumber", () => {
  it("numbers 1..N in canonical order and returns only what changes", () => {
    const rows = [product(0, "2026-01-01"), product(0, "2026-03-01"), product(0, "2026-02-01")];
    const plan = planRenumber(rows);
    expect(plan.sorted.map((row) => row.createdAt.toISOString().slice(0, 7))).toEqual(["2026-03", "2026-02", "2026-01"]);
    expect(plan.changes.map((change) => change.to)).toEqual([1, 2, 3]);
    expect(planRenumber(plan.sorted.map((row, index) => ({ ...row, order: index + 1 }))).changes).toEqual([]);
  });

  it("an empty catalogue has nothing to do", () => {
    expect(planRenumber([])).toMatchObject({ total: 0, changes: [] });
  });
});

describe("renumber against a throwaway database", () => {
  beforeAll(async () => {
    client = new MongoClient(URI);
    await client.connect();
    db = client.db(DB_NAME);
  });
  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it("a dry run writes nothing; apply preserves the visible order; a second apply changes 0; updatedAt is untouched", async () => {
    await db.collection("products").deleteMany({});
    const updatedAt = new Date("2026-01-01");
    await db.collection("products").insertMany([
      { ...product(0, "2026-01-01"), updatedAt }, { ...product(0, "2026-03-01"), updatedAt }, { ...product(5, "2026-02-01"), updatedAt },
      { _id: new ObjectId(), createdAt: new Date("2026-02-15"), updatedAt }, // no order field at all
    ]);
    const before = await visibleOrder(db);
    const stored = await db.collection("products").find({}).sort({ _id: 1 }).toArray();

    expect(await renumber(db)).toMatchObject({ total: 4, wouldChange: 4, changed: 0 });
    expect(await db.collection("products").find({}).sort({ _id: 1 }).toArray()).toEqual(stored);

    expect(await renumber(db, { apply: true })).toMatchObject({ total: 4, changed: 4, skippedChanged: 0 });
    expect(await visibleOrder(db)).toEqual(before);
    const after = await db.collection("products").find({}).toArray();
    expect(after.map((row) => row.order).sort()).toEqual([1, 2, 3, 4]);
    expect(after.every((row) => row.updatedAt.getTime() === updatedAt.getTime())).toBe(true);

    expect(await renumber(db, { apply: true })).toMatchObject({ wouldChange: 0, changed: 0 });
  });
});
