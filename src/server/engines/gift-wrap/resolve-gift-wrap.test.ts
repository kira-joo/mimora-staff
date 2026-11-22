import { toMoney } from "@kira-joo/toolkit-common";
import { describe, expect, it } from "vitest";
import { resolveGiftWrap } from "./resolve-gift-wrap";

const on = { giftWrapEnabled: true, giftWrapFee: toMoney("50") };

describe("resolveGiftWrap", () => {
  it("charges the fee once when enabled, priced, and ticked", () => {
    const result = resolveGiftWrap(on, true);
    expect(result).toMatchObject({ available: true, selected: true });
    expect(result.fee?.toFixed(2)).toBe("50.00");
    expect(result.charge?.toFixed(2)).toBe("50.00");
  });

  it("offers it but charges nothing when not ticked", () => {
    for (const requested of [false, undefined]) {
      const result = resolveGiftWrap(on, requested);
      expect(result).toMatchObject({ available: true, selected: false, charge: undefined });
      expect(result.fee?.toFixed(2)).toBe("50.00");
    }
  });

  it("is not offered — and charges nothing even if ticked — when disabled, unpriced, or priced at zero", () => {
    for (const settings of [{ giftWrapEnabled: false, giftWrapFee: toMoney("50") }, { giftWrapEnabled: true }, { giftWrapEnabled: true, giftWrapFee: null }, { giftWrapEnabled: true, giftWrapFee: toMoney("0") }, {}]) {
      expect(resolveGiftWrap(settings, true)).toEqual({ available: false, selected: false, fee: null, charge: undefined });
    }
  });

  it("rounds the fee to the money scale", () => {
    expect(resolveGiftWrap({ giftWrapEnabled: true, giftWrapFee: toMoney("49.999") }, true).charge?.toFixed(2)).toBe("50.00");
  });
});
