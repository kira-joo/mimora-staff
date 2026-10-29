import { describe, expect, it } from "vitest";
import { parseDelta, previewStock, stockState } from "./stock-state";

describe("stockState", () => {
  it("is out at or below zero, with or without a threshold", () => {
    expect(stockState(0)).toBe("OUT");
    expect(stockState(-2)).toBe("OUT");
    expect(stockState(0, 5)).toBe("OUT");
  });
  it("does not guess a threshold: positive stock without one is only 'available'", () => {
    expect(stockState(1)).toBe("AVAILABLE");
    expect(stockState(500)).toBe("AVAILABLE");
  });
  it("uses the backend classifier when the variant has its own threshold", () => {
    expect(stockState(5, 5)).toBe("LOW");
    expect(stockState(6, 5)).toBe("IN_STOCK");
  });
});

describe("parseDelta", () => {
  it("accepts non-zero integers", () => {
    expect(parseDelta("12")).toBe(12);
    expect(parseDelta("+3")).toBe(3);
    expect(parseDelta(" -4 ")).toBe(-4);
  });
  it("rejects zero, decimals, blanks and text", () => {
    for (const bad of ["0", "-0", "1.5", "", " ", "abc", "1e3"]) expect(parseDelta(bad)).toBeNull();
  });
});

describe("previewStock", () => {
  it("adds the delta, or nothing when invalid", () => {
    expect(previewStock(10, -3)).toBe(7);
    expect(previewStock(10, null)).toBeNull();
  });
});
