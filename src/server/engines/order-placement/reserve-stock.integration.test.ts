// @vitest-environment node
import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { VariantModel } from "../../catalog/variant.schema";
import { connectToDatabase } from "../../core/db/connect";
import { aggregateReservations, releaseStock, reserveStock } from "./reserve-stock";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
/*
 * `connectToDatabase()` passes `dbName: process.env.MONGODB_DB ||
 * "store-platform-staff"` to `mongoose.connect()`, and that option overrides
 * whatever database name appears in the URI's path — the `-test` suffix
 * above is silently ignored without this. Without it, every integration
 * test in this repo runs against the same database a local `npm run dev`
 * session defaults to.
 */
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await VariantModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

async function createVariant(overrides: Partial<{ stock: number; backorderPolicy: "DENY" | "CONTINUE_SELLING" }> = {}) {
  const doc = await VariantModel.create({
    productId: new mongoose.Types.ObjectId(),
    sku: `SKU-${new mongoose.Types.ObjectId().toString()}`,
    variantKey: `key-${new mongoose.Types.ObjectId().toString()}`,
    price: toMoney("50.00"),
    stock: 10,
    backorderPolicy: "DENY",
    ...overrides,
  });
  return doc._id as mongoose.Types.ObjectId;
}

describe("reserveStock", () => {
  it("decrements stock by the requested quantity", async () => {
    const variantId = await createVariant({ stock: 10 });

    await withTransaction(async (tx) => {
      await reserveStock([{ variantId, quantity: 3, backorderPolicy: "DENY" }]);
      return tx.complete(undefined);
    });

    const updated = await VariantModel.findById(variantId).lean();
    expect(updated?.stock).toBe(7);
  });

  it("refuses to oversell — the quantity predicate lives in the filter, not a prior read", async () => {
    const variantId = await createVariant({ stock: 2 });

    await expect(
      withTransaction(async (tx) => {
        await reserveStock([{ variantId, quantity: 5, backorderPolicy: "DENY" }]);
        return tx.complete(undefined);
      })
    ).rejects.toThrow(/no longer available/);

    const unchanged = await VariantModel.findById(variantId).lean();
    expect(unchanged?.stock).toBe(2); // untouched — the whole reservation rolled back
  });

  it("CONTINUE_SELLING decrements past zero without refusing", async () => {
    const variantId = await createVariant({ stock: 1, backorderPolicy: "CONTINUE_SELLING" });

    await withTransaction(async (tx) => {
      await reserveStock([{ variantId, quantity: 5, backorderPolicy: "CONTINUE_SELLING" }]);
      return tx.complete(undefined);
    });

    const updated = await VariantModel.findById(variantId).lean();
    expect(updated?.stock).toBe(-4);
  });

  it("oversell under contention: exactly one of two concurrent buyers gets the last unit", async () => {
    /*
     * The load-bearing test for this whole module. Two transactions
     * simultaneously request the single remaining unit; the quantity
     * predicate inside the filter is what makes exactly one succeed rather
     * than both reading "1 left" and both decrementing.
     */
    const variantId = await createVariant({ stock: 1 });

    const attempt = () =>
      withTransaction(async (tx) => {
        await reserveStock([{ variantId, quantity: 1, backorderPolicy: "DENY" }]);
        return tx.complete("ok");
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser must get a retryable, customer-meaningful failure — not a raw
    // Mongo WriteConflict / TransientTransactionError leaking out of the engine.
    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserReason).toBeInstanceOf(ConflictError);
    expect((loserReason as Error).message).toMatch(/no longer available in the quantity requested/);

    const finalStock = await VariantModel.findById(variantId).lean();
    expect(finalStock?.stock).toBe(0);
  });

  it("rolls back every earlier decrement in the same transaction when a later one fails", async () => {
    // Phase 3 spec: "a commit test AND a rollback test asserting no
    // collection retains partial state" — this is that test for a
    // multi-line order.
    const plentiful = await createVariant({ stock: 10 });
    const scarce = await createVariant({ stock: 1 });

    await expect(
      withTransaction(async (tx) => {
        await reserveStock([
          { variantId: plentiful, quantity: 2, backorderPolicy: "DENY" },
          { variantId: scarce, quantity: 5, backorderPolicy: "DENY" },
        ]);
        return tx.complete(undefined);
      })
    ).rejects.toThrow();

    const plentifulAfter = await VariantModel.findById(plentiful).lean();
    const scarceAfter = await VariantModel.findById(scarce).lean();
    expect(plentifulAfter?.stock).toBe(10); // its own successful decrement was rolled back too
    expect(scarceAfter?.stock).toBe(1);
  });
});

describe("releaseStock", () => {
  it("restores stock with no upper bound check", async () => {
    const variantId = await createVariant({ stock: 5 });

    await withTransaction(async (tx) => {
      await releaseStock([{ variantId, quantity: 3, backorderPolicy: "DENY" }]);
      return tx.complete(undefined);
    });

    const updated = await VariantModel.findById(variantId).lean();
    expect(updated?.stock).toBe(8);
  });
});

describe("aggregateReservations", () => {
  it("sums duplicate variants into a single reservation", () => {
    const variantId = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();

    const aggregated = aggregateReservations([
      { variantId, quantity: 2, backorderPolicy: "DENY" },
      { variantId: other, quantity: 1, backorderPolicy: "DENY" },
      { variantId, quantity: 3, backorderPolicy: "DENY" },
    ]);

    expect(aggregated).toHaveLength(2);
    expect(aggregated.find((r) => r.variantId.equals(variantId))?.quantity).toBe(5);
    expect(aggregated.find((r) => r.variantId.equals(other))?.quantity).toBe(1);
  });

  it("leaves a basket with no duplicates unchanged in content", () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const aggregated = aggregateReservations([
      { variantId: a, quantity: 1, backorderPolicy: "DENY" },
      { variantId: b, quantity: 1, backorderPolicy: "DENY" },
    ]);
    expect(aggregated).toHaveLength(2);
  });
});
