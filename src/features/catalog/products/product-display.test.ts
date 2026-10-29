import { describe, expect, it } from "vitest";
import { priceRange } from "./product-display";

const money = (value: string) => `EGP ${value}`;

describe("priceRange", () => {
  it("shows a dash when no variant is active", () => {
    expect(priceRange({ purchasableVariantCount: 0 }, money)).toBe("—");
  });

  it("shows one figure when every active price is equal", () => {
    expect(priceRange({ minActivePrice: "250.00", maxActivePrice: "250.00", purchasableVariantCount: 2 }, money)).toBe("EGP 250.00");
  });

  it("shows the span otherwise", () => {
    expect(priceRange({ minActivePrice: "250.00", maxActivePrice: "300.00", purchasableVariantCount: 3 }, money)).toBe("EGP 250.00 – EGP 300.00");
  });

  it("falls back to whichever bound exists", () => {
    expect(priceRange({ maxActivePrice: "99.50", purchasableVariantCount: 1 }, money)).toBe("EGP 99.50");
  });
});
