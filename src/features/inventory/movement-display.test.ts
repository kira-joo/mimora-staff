import { describe, expect, it } from "vitest";
import { MOVEMENT_REASON_LABEL, MOVEMENT_REASON_OPTIONS, formatDelta } from "./movement-display";

describe("formatDelta", () => {
  it("always shows the sign, with a true minus", () => {
    expect(formatDelta(5)).toBe("+5");
    expect(formatDelta(-3)).toBe("−3");
    expect(formatDelta(0)).toBe("0");
  });
});

describe("movement reasons", () => {
  it("offers a filter option for every reason the server records", () => {
    expect(MOVEMENT_REASON_OPTIONS.map((option) => option.value).sort()).toEqual(["ADJUSTMENT", "DAMAGE", "RECEIPT", "RETURN", "SALE"]);
    expect(Object.values(MOVEMENT_REASON_LABEL).every((label) => label.length > 0)).toBe(true);
  });
});
