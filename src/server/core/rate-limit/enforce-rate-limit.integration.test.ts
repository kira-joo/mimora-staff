// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../db/connect";
import { RateLimitModel } from "./rate-limit.schema";
import { RateLimitExceededError, clearRateLimit, enforceRateLimit } from "./enforce-rate-limit";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await RateLimitModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("enforceRateLimit", () => {
  it("allows attempts up to the limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(enforceRateLimit({ key: "login:1.2.3.4", maxAttempts: 5, windowMs: 60_000 })).resolves.not.toThrow();
    }
  });

  it("throws RateLimitExceededError once the limit is exceeded, carrying a retry-after", async () => {
    for (let i = 0; i < 5; i += 1) {
      await enforceRateLimit({ key: "login:5.6.7.8", maxAttempts: 5, windowMs: 60_000 });
    }

    const error = await enforceRateLimit({ key: "login:5.6.7.8", maxAttempts: 5, windowMs: 60_000 }).catch((e) => e);
    expect(error).toBeInstanceOf(RateLimitExceededError);
    expect((error as RateLimitExceededError).statusCode).toBe(429);
    expect((error as RateLimitExceededError).retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keys are independent — exhausting one key does not affect another", async () => {
    for (let i = 0; i < 5; i += 1) {
      await enforceRateLimit({ key: "login:1.1.1.1", maxAttempts: 5, windowMs: 60_000 });
    }
    await expect(enforceRateLimit({ key: "login:1.1.1.1", maxAttempts: 5, windowMs: 60_000 })).rejects.toThrow(RateLimitExceededError);
    // A different key, same limit, starts fresh.
    await expect(enforceRateLimit({ key: "login:2.2.2.2", maxAttempts: 5, windowMs: 60_000 })).resolves.not.toThrow();
  });

  it("clearRateLimit resets the counter after a successful attempt", async () => {
    for (let i = 0; i < 5; i += 1) {
      await enforceRateLimit({ key: "login:9.9.9.9", maxAttempts: 5, windowMs: 60_000 });
    }
    await clearRateLimit("login:9.9.9.9");

    await expect(enforceRateLimit({ key: "login:9.9.9.9", maxAttempts: 5, windowMs: 60_000 })).resolves.not.toThrow();
  });

  it("is race-safe: N concurrent attempts against a limit of N all succeed, and the (N+1)th sequential attempt is rejected — no lost updates", async () => {
    const key = "order-placement:concurrent-test";
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => enforceRateLimit({ key, maxAttempts: 8, windowMs: 60_000 }))
    );
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    // The count must be exactly 8, not less — a read-then-write implementation
    // would lose increments under this exact concurrent load.
    const record = await RateLimitModel.findOne({ key }).lean();
    expect(record?.count).toBe(8);

    await expect(enforceRateLimit({ key, maxAttempts: 8, windowMs: 60_000 })).rejects.toThrow(RateLimitExceededError);
  });

  it("anchors the window to the FIRST attempt — a later attempt does not push expiresAt forward", async () => {
    const key = "login:anchor-test";
    await enforceRateLimit({ key, maxAttempts: 10, windowMs: 60_000 });
    const first = await RateLimitModel.findOne({ key }).lean();

    await new Promise((resolve) => setTimeout(resolve, 50));
    await enforceRateLimit({ key, maxAttempts: 10, windowMs: 60_000 });
    const second = await RateLimitModel.findOne({ key }).lean();

    expect(second?.expiresAt.getTime()).toBe(first?.expiresAt.getTime()); // unchanged — $setOnInsert only fires once
  });
});
