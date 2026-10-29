import { describe, expect, it } from "vitest";
import { collectAvailableOptions, optionPair, resolveListingLowStock, summarizeLowStock } from "./listing-options";

const v = (size: string, colour: string, purchasable: boolean) => ({ optionValues: [{ key: "size", value: size }, { key: "colour", value: colour }], purchasable });

describe("collectAvailableOptions", () => {
  it("is the union of option values across purchasable variants, sorted and unique", () => {
    expect(collectAvailableOptions([v("s", "red", true), v("m", "red", true)])).toEqual(["colour:red", "size:m", "size:s"]);
  });

  it("a value present only on a sold-out variant is not available (sparse matrix)", () => {
    expect(collectAvailableOptions([v("s", "red", true), v("m", "blue", false)])).toEqual(["colour:red", "size:s"]);
  });

  it("a value on both a sold-out and a purchasable variant stays available", () => {
    expect(collectAvailableOptions([v("s", "red", true), v("m", "red", false), v("s", "blue", false)])).toEqual(["colour:red", "size:s"]);
  });

  it("is empty when nothing is purchasable, and for a product with no options", () => {
    expect(collectAvailableOptions([v("s", "red", false)])).toEqual([]);
    expect(collectAvailableOptions([{ optionValues: [], purchasable: true }])).toEqual([]);
    expect(collectAvailableOptions([])).toEqual([]);
  });

  it("encodes a pair as key:value", () => {
    expect(optionPair("size", "xl")).toBe("size:xl");
  });
});

describe("summarizeLowStock", () => {
  const tracked = (stock: number, lowStockThreshold?: number) => ({ purchasable: stock > 0, backorderPolicy: "DENY" as const, stock, lowStockThreshold });

  it("takes the smallest stock among purchasable tracked variants on the store-wide threshold", () => {
    expect(summarizeLowStock([tracked(9), tracked(3), tracked(20)])).toEqual({ lowStockOverride: false, minTrackedStock: 3 });
  });

  it("ignores sold-out variants — out of stock is never 'low'", () => {
    expect(summarizeLowStock([tracked(0), tracked(8)])).toEqual({ lowStockOverride: false, minTrackedStock: 8 });
  });

  it("ignores CONTINUE_SELLING variants — their stock is not a constraint", () => {
    expect(summarizeLowStock([{ purchasable: true, backorderPolicy: "CONTINUE_SELLING", stock: 1 }])).toEqual({ lowStockOverride: false });
  });

  it("a variant with its own threshold is judged by it, and does not feed the store-wide minimum", () => {
    expect(summarizeLowStock([tracked(4, 10)])).toEqual({ lowStockOverride: true });
    expect(summarizeLowStock([tracked(4, 2)])).toEqual({ lowStockOverride: false });
  });
});

describe("resolveListingLowStock", () => {
  it("is low at or below the current store-wide threshold, not above", () => {
    expect(resolveListingLowStock({ lowStockOverride: false, minTrackedStock: 5 }, 5)).toBe(true);
    expect(resolveListingLowStock({ lowStockOverride: false, minTrackedStock: 6 }, 5)).toBe(false);
  });

  it("follows a changed store-wide threshold without any recompute", () => {
    const facts = { lowStockOverride: false, minTrackedStock: 8 };
    expect(resolveListingLowStock(facts, 5)).toBe(false);
    expect(resolveListingLowStock(facts, 10)).toBe(true);
  });

  it("an override variant at its threshold is low whatever the store-wide threshold is", () => {
    expect(resolveListingLowStock({ lowStockOverride: true }, 0)).toBe(true);
  });

  it("is false when the rollup has no facts (an un-rebuilt product)", () => {
    expect(resolveListingLowStock(undefined, 5)).toBe(false);
    expect(resolveListingLowStock({}, 5)).toBe(false);
  });
});
