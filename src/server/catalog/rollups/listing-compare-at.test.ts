import { toMoney } from "@kira-joo/toolkit-common";
import { describe, expect, it } from "vitest";
import { resolveListingCompareAt } from "./listing-compare-at";

const v = (price: string, compareAt: string | undefined, purchasable = true) => ({ price: toMoney(price), compareAtPrice: compareAt ? toMoney(compareAt) : undefined, purchasable });

describe("resolveListingCompareAt", () => {
  it("is present when the cheapest purchasable variant has a higher compare-at", () => {
    expect(resolveListingCompareAt([v("80", "100"), v("120", "150")])?.toString()).toBe("100");
  });

  it("is absent when the cheapest variant has no compare-at, even if a dearer one does", () => {
    expect(resolveListingCompareAt([v("80", undefined), v("120", "150")])).toBeUndefined();
  });

  it("is absent when compare-at equals the price, or is below it", () => {
    expect(resolveListingCompareAt([v("80", "80")])).toBeUndefined();
    expect(resolveListingCompareAt([v("80", "60")])).toBeUndefined();
  });

  it("ignores a cheaper variant that is not purchasable — the advertised price is the cheapest one you can buy", () => {
    expect(resolveListingCompareAt([v("50", "90", false), v("80", "100")])?.toString()).toBe("100");
    expect(resolveListingCompareAt([v("50", "90", false), v("80", undefined)])).toBeUndefined();
  });

  it("is absent when nothing is purchasable, or there are no variants", () => {
    expect(resolveListingCompareAt([v("50", "90", false)])).toBeUndefined();
    expect(resolveListingCompareAt([])).toBeUndefined();
  });

  it("on a price tie among the cheapest, the largest valid compare-at wins", () => {
    expect(resolveListingCompareAt([v("80", undefined), v("80", "95"), v("80", "110")])?.toString()).toBe("110");
  });

  it("compares as exact decimals, not floats", () => {
    expect(resolveListingCompareAt([v("0.10", "0.30")])?.toString()).toBe("0.3");
  });
});
