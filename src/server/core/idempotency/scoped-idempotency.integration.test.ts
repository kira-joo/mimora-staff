// @vitest-environment node
import { IdempotencyInFlightError, IdempotencyKeyReuseError } from "@kira-joo/backend-toolkit-next";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { IdempotencyRecordModel } from "../../commerce/idempotency-record.schema";
import { connectToDatabase } from "../db/connect";
import { claimIdempotentMutation, completeIdempotentMutation, releaseIdempotentMutation } from "./scoped-idempotency";

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

function request(): NextRequest {
  return new NextRequest("https://staff.example.com/api/shop/orders", {
    method: "POST",
    headers: { "Idempotency-Key": "client-key-1" },
  });
}

describe("claimIdempotentMutation / completeIdempotentMutation / releaseIdempotentMutation", () => {
  it("throws BadRequestError when no Idempotency-Key header is present", async () => {
    const bareRequest = new NextRequest("https://staff.example.com/api/shop/orders", { method: "POST" });
    await expect(
      claimIdempotentMutation({ route: "POST /api/shop/orders", actorId: "actor-1", request: bareRequest, body: { a: 1 } })
    ).rejects.toThrow(/requires an Idempotency-Key/);
  });

  it("same actor + same route + same key + same body → replay (does not re-run the mutation)", async () => {
    const options = { route: "POST /api/shop/orders", actorId: "actor-1", request: request(), body: { cartId: "c1" } };

    const first = await claimIdempotentMutation(options);
    expect(first.claimed).toBe(true);
    await completeIdempotentMutation(first, { status: 201, body: { orderId: "order-1" } });

    const replay = await claimIdempotentMutation(options);
    expect(replay.claimed).toBe(false);
    expect(replay.cachedResponse).toEqual({ status: 201, body: { orderId: "order-1" } });
  });

  it("same actor + same route + same key + DIFFERENT body → IdempotencyKeyReuseError", async () => {
    const base = { route: "POST /api/shop/orders", actorId: "actor-1", request: request() };

    const first = await claimIdempotentMutation({ ...base, body: { cartId: "c1" } });
    await completeIdempotentMutation(first, { status: 201, body: { orderId: "order-1" } });

    await expect(claimIdempotentMutation({ ...base, body: { cartId: "DIFFERENT" } })).rejects.toThrow(IdempotencyKeyReuseError);
  });

  it("different actors + same client key + same route → no collision (each gets its own claim)", async () => {
    const claimA = await claimIdempotentMutation({ route: "POST /api/shop/orders", actorId: "actor-A", request: request(), body: { cartId: "cA" } });
    const claimB = await claimIdempotentMutation({ route: "POST /api/shop/orders", actorId: "actor-B", request: request(), body: { cartId: "cB" } });

    expect(claimA.claimed).toBe(true);
    expect(claimB.claimed).toBe(true); // NOT blocked by actor A's claim — this is the exact cross-user hazard being fixed
    expect(claimA.key).not.toBe(claimB.key);

    await completeIdempotentMutation(claimA, { status: 201, body: { orderId: "order-A" } });
    const replayA = await claimIdempotentMutation({ route: "POST /api/shop/orders", actorId: "actor-A", request: request(), body: { cartId: "cA" } });
    expect(replayA.cachedResponse?.body).toEqual({ orderId: "order-A" }); // A's own record, unaffected by B
  });

  it("different routes + same client key + same actor → no collision", async () => {
    const claimOrders = await claimIdempotentMutation({ route: "POST /api/shop/orders", actorId: "actor-1", request: request(), body: { cartId: "c1" } });
    const claimReturns = await claimIdempotentMutation({ route: "POST /api/shop/returns", actorId: "actor-1", request: request(), body: { orderId: "o1" } });

    expect(claimOrders.claimed).toBe(true);
    expect(claimReturns.claimed).toBe(true); // same literal "Idempotency-Key" header value, different route → different scoped key
    expect(claimOrders.key).not.toBe(claimReturns.key);
  });

  it("release lets a genuinely failed mutation retry — a fresh claim on the same key succeeds again", async () => {
    const options = { route: "POST /api/shop/orders", actorId: "actor-1", request: request(), body: { cartId: "c1" } };

    const first = await claimIdempotentMutation(options);
    await releaseIdempotentMutation(first);

    const retry = await claimIdempotentMutation(options);
    expect(retry.claimed).toBe(true);
  });

  it("a second claim while the first is still in flight (not yet completed) throws IdempotencyInFlightError", async () => {
    const options = { route: "POST /api/shop/orders", actorId: "actor-1", request: request(), body: { cartId: "c1" } };

    await claimIdempotentMutation(options); // claimed, never completed or released — simulates "still processing"

    await expect(claimIdempotentMutation(options)).rejects.toThrow(IdempotencyInFlightError);
  });

  it("concurrent same-key requests: exactly one winner, the rest see in-flight or the eventual replay — never two successful claims", async () => {
    const options = { route: "POST /api/shop/orders", actorId: "actor-1", request: request(), body: { cartId: "c1" } };

    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => claimIdempotentMutation(options)));

    const claimed = attempts.filter((attempt) => attempt.status === "fulfilled" && attempt.value.claimed);
    expect(claimed).toHaveLength(1); // exactly one — the unique index on IdempotencyRecord.key enforces this, not application logic

    const records = await IdempotencyRecordModel.find({}).lean();
    expect(records).toHaveLength(1); // no duplicate document survives the race
  });
});
