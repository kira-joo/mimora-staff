import { describe, expect, it } from "vitest";
import { ProductOrderError, applyScopedOrder, compareProductsManual, orderChanges, sortProductsManual } from "./product-order";

const p = (id: string, order: number, createdAt: string) => ({ id, order, createdAt: new Date(createdAt) });

describe("compareProductsManual / sortProductsManual", () => {
  it("is empty-safe", () => {
    expect(sortProductsManual([])).toEqual([]);
  });

  it("sorts by order ascending", () => {
    const sorted = sortProductsManual([p("a", 3, "2026-01-01"), p("b", 1, "2026-01-02"), p("c", 2, "2026-01-03")]);
    expect(sorted.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties newest-first, so all-zero orders read as 'newest' (today's storefront)", () => {
    const sorted = sortProductsManual([p("old", 0, "2026-01-01"), p("new", 0, "2026-03-01"), p("mid", 0, "2026-02-01")]);
    expect(sorted.map((x) => x.id)).toEqual(["new", "mid", "old"]);
  });

  it("breaks createdAt ties by id descending", () => {
    const sorted = sortProductsManual([p("0001", 0, "2026-01-01"), p("0003", 0, "2026-01-01"), p("0002", 0, "2026-01-01")]);
    expect(sorted.map((x) => x.id)).toEqual(["0003", "0002", "0001"]);
  });

  it("accepts string and numeric createdAt and does not mutate the input", () => {
    const input = [{ id: "a", order: 0, createdAt: "2026-01-01T00:00:00Z" }, { id: "b", order: 0, createdAt: Date.parse("2026-02-01T00:00:00Z") }];
    expect(sortProductsManual(input).map((x) => x.id)).toEqual(["b", "a"]);
    expect(input.map((x) => x.id)).toEqual(["a", "b"]);
    expect(compareProductsManual(input[0]!, input[0]!)).toBe(0);
  });

  it("orders by number, not by age, once products are numbered", () => {
    const sorted = sortProductsManual([p("appended", 54, "2026-05-01"), p("first", 1, "2026-01-01")]);
    expect(sorted.map((x) => x.id)).toEqual(["first", "appended"]);
  });
});

describe("applyScopedOrder", () => {
  it("empty global and empty scope", () => {
    expect(applyScopedOrder([], [])).toEqual([]);
  });

  it("an empty scope changes nothing", () => {
    expect(applyScopedOrder(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("scope = everything: the new order is the global order", () => {
    expect(applyScopedOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("scope = one item changes nothing", () => {
    expect(applyScopedOrder(["a", "b", "c"], ["b"])).toEqual(["a", "b", "c"]);
  });

  it("a non-contiguous scope keeps the positions it occupies; non-scope items never move", () => {
    // scope {a, c, e} sits at positions 0, 2, 4; reversed into those same slots
    expect(applyScopedOrder(["a", "b", "c", "d", "e"], ["e", "c", "a"])).toEqual(["e", "b", "c", "d", "a"]);
    expect(applyScopedOrder(["a", "b", "c", "d", "e"], ["c", "e", "a"])).toEqual(["c", "b", "e", "d", "a"]);
  });

  it("a contiguous scope is reordered in place", () => {
    expect(applyScopedOrder(["x", "a", "b", "c", "y"], ["c", "a", "b"])).toEqual(["x", "c", "a", "b", "y"]);
  });

  it("rejects duplicate ids in the new order", () => {
    expect(() => applyScopedOrder(["a", "b", "c"], ["a", "a"])).toThrow(ProductOrderError);
  });

  it("rejects an id that is not in the global order", () => {
    expect(() => applyScopedOrder(["a", "b"], ["a", "zzz"])).toThrow(/Unknown product id/);
  });

  it("rejects a duplicated global order", () => {
    expect(() => applyScopedOrder(["a", "a"], ["a"])).toThrow(ProductOrderError);
  });
});

describe("orderChanges", () => {
  it("empty -> no changes", () => {
    expect(orderChanges(new Map(), [])).toEqual([]);
  });

  it("numbers 1..N and returns every product when all are 0", () => {
    const current = new Map([["a", 0], ["b", 0], ["c", 0]]);
    expect(orderChanges(current, ["c", "a", "b"])).toEqual([{ id: "c", order: 1 }, { id: "a", order: 2 }, { id: "b", order: 3 }]);
  });

  it("returns only the products whose order must change", () => {
    const current = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4]]);
    expect(orderChanges(current, ["a", "c", "b", "d"])).toEqual([{ id: "c", order: 2 }, { id: "b", order: 3 }]);
  });

  it("is idempotent: an already-normalised catalogue yields nothing", () => {
    const current = new Map([["a", 1], ["b", 2]]);
    expect(orderChanges(current, ["a", "b"])).toEqual([]);
  });

  it("treats a product missing from the current map as changed", () => {
    expect(orderChanges(new Map(), ["a"])).toEqual([{ id: "a", order: 1 }]);
  });

  it("rejects duplicate ids", () => {
    expect(() => orderChanges(new Map(), ["a", "a"])).toThrow(ProductOrderError);
  });
});
