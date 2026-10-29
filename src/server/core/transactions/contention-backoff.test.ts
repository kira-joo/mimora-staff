import { describe, expect, it } from "vitest";
import { CONTENDED_MAX_RETRIES, contentionDelayMs } from "./contention-backoff";

describe("contentionDelayMs", () => {
  it("never delays the first attempt", () => {
    expect(contentionDelayMs(1, () => 1)).toBe(0);
  });

  it("grows exponentially and is capped", () => {
    const ceilings = [2, 3, 4, 5, 6, 7, 8, 9].map((attempt) => contentionDelayMs(attempt, () => 1));
    expect(ceilings).toEqual([20, 40, 80, 160, 320, 500, 500, 500]);
  });

  it("is full jitter: anywhere from zero to the ceiling", () => {
    expect(contentionDelayMs(5, () => 0)).toBe(0);
    expect(contentionDelayMs(5, () => 0.5)).toBe(80);
  });

  it("bounds the worst-case total wait of a placement to a few seconds", () => {
    let total = 0;
    for (let attempt = 2; attempt <= CONTENDED_MAX_RETRIES + 1; attempt++) total += contentionDelayMs(attempt, () => 1);
    expect(total).toBeLessThanOrEqual(2500);
  });
});
