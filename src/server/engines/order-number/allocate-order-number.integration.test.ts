// @vitest-environment node
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { OrderSequenceModel } from "../../commerce/order-sequence.schema";
import { allocateOrderNumber, formatOrderNumber } from "./allocate-order-number";

/*
 * A real replica set, not an in-memory one — `docker compose up -d` in this
 * repo, matching this repo's own CLAUDE.md verification philosophy ("run real
 * servers against a real database"). Transactions do not run on a standalone
 * node, and this suite's whole point is to prove behaviour that only exists
 * inside a transaction.
 */
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
  await OrderSequenceModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("formatOrderNumber", () => {
  it("zero-pads to six digits", () => {
    expect(formatOrderNumber(1)).toBe("ORD-000001");
    expect(formatOrderNumber(42)).toBe("ORD-000042");
  });

  it("does not truncate past six digits", () => {
    expect(formatOrderNumber(1234567)).toBe("ORD-1234567");
  });
});

describe("allocateOrderNumber", () => {
  it("starts at 1 and increments", async () => {
    await withTransaction(async (tx) => {
      expect(await allocateOrderNumber()).toBe("ORD-000001");
      expect(await allocateOrderNumber()).toBe("ORD-000002");
      return tx.complete(undefined);
    });
  });

  it("never hands out the same number to concurrent callers", async () => {
    /*
     * `Promise.allSettled`, not `Promise.all` — on a single-node dev replica
     * set, 10-way write contention on one counter document can genuinely
     * exhaust the retry budget for a few callers. Per the Phase 3 spec: "a hot
     * last unit... may exhaust the retry budget, surfacing as a retryable
     * service-unavailable. That is the correct outcome, and better than
     * overselling" — the same principle applies to a hot counter. What must
     * never happen is a duplicate among whichever calls DID succeed.
     */
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        withTransaction(async (tx) => tx.complete(await allocateOrderNumber()))
      )
    );

    const fulfilled = outcomes.filter((o): o is PromiseFulfilledResult<string> => o.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThan(0);
    expect(new Set(fulfilled.map((o) => o.value)).size).toBe(fulfilled.length);
  });

  it("returns the number when its transaction rolls back, leaving no gap", async () => {
    await withTransaction(async (tx) => {
      expect(await allocateOrderNumber()).toBe("ORD-000001");
      return tx.complete(undefined);
    });

    await withTransaction(async () => {
      await allocateOrderNumber(); // would be 0002
      throw new Error("simulated failure after allocation");
    }).catch(() => undefined);

    await withTransaction(async (tx) => {
      // The rolled-back attempt's number was never committed, so this call
      // gets it instead — no gap.
      expect(await allocateOrderNumber()).toBe("ORD-000002");
      return tx.complete(undefined);
    });
  });
});
