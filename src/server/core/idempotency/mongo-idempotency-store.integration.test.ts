// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { IdempotencyRecordModel } from "../../commerce/idempotency-record.schema";
import { connectToDatabase } from "../db/connect";
import { mongoIdempotencyStore } from "./mongo-idempotency-store";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await IdempotencyRecordModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("mongoIdempotencyStore", () => {
  it("claims a fresh key", async () => {
    const result = await mongoIdempotencyStore.begin("order:route:actor1:key1", "hash1");
    expect(result.claimed).toBe(true);
  });

  it("a second begin on the same key while still in flight reports unclaimed with no record", async () => {
    await mongoIdempotencyStore.begin("k1", "hash1");

    const second = await mongoIdempotencyStore.begin("k1", "hash1");
    expect(second.claimed).toBe(false);
    expect(second.record).toBeUndefined(); // in flight — complete() was never called
  });

  it("replays the completed response for a repeated key with the same request hash", async () => {
    await mongoIdempotencyStore.begin("k1", "hash1");
    await mongoIdempotencyStore.complete("k1", { status: 201, body: { orderId: "abc" }, requestHash: "hash1" });

    const replay = await mongoIdempotencyStore.begin("k1", "hash1");
    expect(replay.claimed).toBe(false);
    expect(replay.record).toEqual({ status: 201, body: { orderId: "abc" }, requestHash: "hash1" });
  });

  it("release lets a genuinely failed request retry — a fresh begin succeeds again", async () => {
    await mongoIdempotencyStore.begin("k1", "hash1");
    await mongoIdempotencyStore.release("k1");

    const retry = await mongoIdempotencyStore.begin("k1", "hash1");
    expect(retry.claimed).toBe(true); // the record was deleted, not marked failed — genuinely retriable
  });

  it("race safety: only one of many concurrent begin() calls on the same key wins", async () => {
    const attempts = await Promise.all(Array.from({ length: 10 }, () => mongoIdempotencyStore.begin("contested-key", "hash1")));

    const winners = attempts.filter((attempt) => attempt.claimed);
    expect(winners).toHaveLength(1); // exactly one — the unique index, not application logic, enforces this

    const documents = await IdempotencyRecordModel.find({ key: "contested-key" }).lean();
    expect(documents).toHaveLength(1); // no duplicate document survives the race either
  });

  it("stores no status/body while still in flight — presence of status is what distinguishes complete from pending", async () => {
    await mongoIdempotencyStore.begin("k1", "hash1");

    const record = await IdempotencyRecordModel.findOne({ key: "k1" }).lean();
    expect(record?.status).toBeUndefined();
    expect(record?.body).toBeUndefined();
  });
});
