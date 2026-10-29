import { describe, expect, it } from "vitest";
import { resolveLowStock } from "./resolve-low-stock";

const base = { purchasable: true, backorderPolicy: "DENY" as const, stock: 5, defaultThreshold: 5 };

describe("resolveLowStock", () => {
  it("is low exactly at the threshold and not one above it", () => {
    expect(resolveLowStock({ ...base, stock: 5 })).toBe(true);
    expect(resolveLowStock({ ...base, stock: 6 })).toBe(false);
    expect(resolveLowStock({ ...base, stock: 1 })).toBe(true);
  });

  it("a variant override beats the store default, in both directions", () => {
    expect(resolveLowStock({ ...base, stock: 8, variantThreshold: 10 })).toBe(true);
    expect(resolveLowStock({ ...base, stock: 4, variantThreshold: 2 })).toBe(false);
    expect(resolveLowStock({ ...base, stock: 0 + 2, variantThreshold: 2 })).toBe(true);
  });

  it("a zero override is honoured, not treated as absent", () => {
    expect(resolveLowStock({ ...base, stock: 1, variantThreshold: 0 })).toBe(false);
  });

  it("is false when not purchasable (out of stock, discontinued)", () => {
    expect(resolveLowStock({ ...base, stock: 0, purchasable: false })).toBe(false);
    expect(resolveLowStock({ ...base, stock: 2, purchasable: false })).toBe(false);
  });

  it("is false for CONTINUE_SELLING however little stock is on hand", () => {
    expect(resolveLowStock({ ...base, stock: 1, backorderPolicy: "CONTINUE_SELLING" })).toBe(false);
  });
});
