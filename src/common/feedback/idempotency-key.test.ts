import { describe, expect, it } from "vitest";
import { createActionKeyRing, newIdempotencyKey } from "./idempotency-key";

const counter = () => {
  let n = 0;
  return () => `key-${++n}`;
};

describe("createActionKeyRing", () => {
  it("gives the same key to a retry of the same action", () => {
    const ring = createActionKeyRing(counter());
    expect(ring.keyFor("refund:o1:{}")).toBe(ring.keyFor("refund:o1:{}"));
  });

  it("gives a different action — another order, amount or verb — its own key", () => {
    const ring = createActionKeyRing(counter());
    const keys = new Set([ring.keyFor("refund:o1:10"), ring.keyFor("refund:o1:20"), ring.keyFor("refund:o2:10"), ring.keyFor("verify:o1:")]);
    expect(keys.size).toBe(4);
  });

  it("mints a fresh key for the next action once the first succeeded (released)", () => {
    const ring = createActionKeyRing(counter());
    const first = ring.keyFor("verify:o1");
    ring.release("verify:o1");
    expect(ring.keyFor("verify:o1")).not.toBe(first);
  });
});

describe("newIdempotencyKey", () => {
  it("never repeats", () => {
    expect(new Set(Array.from({ length: 50 }, newIdempotencyKey)).size).toBe(50);
  });
});
