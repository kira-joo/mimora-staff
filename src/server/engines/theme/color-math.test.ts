import { describe, expect, it } from "vitest";
import { contrastRatio, expandHexShorthand, hslToRgb, parseHex, relativeLuminance, rgbToHsl, toHex } from "./color-math";

describe("expandHexShorthand", () => {
  it("doubles each digit of a three-digit colour, as CSS reads it", () => {
    expect(expandHexShorthand("#fff")).toBe("#ffffff");
    expect(expandHexShorthand("#1aF")).toBe("#11aaFF");
    expect(parseHex(expandHexShorthand("#f80"))).toEqual({ r: 255, g: 136, b: 0 });
  });

  it("leaves a six-digit colour, and anything malformed, untouched", () => {
    for (const value of ["#6B8F71", "#ffff", "fff", "#ggg", "red", ""]) expect(expandHexShorthand(value)).toBe(value);
  });
});

describe("parseHex", () => {
  it("parses a 6-digit hex colour with or without a leading #", () => {
    expect(parseHex("#FFFFFF")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("is case-insensitive", () => {
    expect(parseHex("#ff00aa")).toEqual({ r: 255, g: 0, b: 170 });
  });

  it("rejects anything malformed rather than coercing it", () => {
    expect(() => parseHex("red")).toThrow(/not a valid/);
    expect(() => parseHex("#FFF")).toThrow(/not a valid/); // the engine stays strict: shorthand is expanded at the API boundary (expandHexShorthand)
    expect(() => parseHex("#GGGGGG")).toThrow(/not a valid/);
    expect(() => parseHex("")).toThrow(/not a valid/);
  });
});

describe("toHex", () => {
  it("round-trips through parseHex", () => {
    expect(toHex(parseHex("#6B8F71"))).toBe("#6B8F71");
  });

  it("clamps and rounds out-of-range channels defensively", () => {
    expect(toHex({ r: 300, g: -10, b: 127.6 })).toBe("#FF0080");
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white, the maximum possible", () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
  });

  it("is 1:1 for a colour against itself", () => {
    const grey = { r: 128, g: 128, b: 128 };
    expect(contrastRatio(grey, grey)).toBeCloseTo(1, 5);
  });

  it("is symmetric regardless of argument order", () => {
    const a = { r: 107, g: 143, b: 113 }; // #6B8F71
    const b = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("reproduces the measured regression case: #6B8F71 on white is ~3.63:1", () => {
    // The exact failure the Phase 3 spec cites as why validation was rejected
    // in favour of derivation.
    const ratio = contrastRatio(parseHexForTest("#6B8F71"), parseHexForTest("#FFFFFF"));
    expect(ratio).toBeCloseTo(3.63, 1);
    expect(ratio).toBeLessThan(4.5); // confirms it fails AA — the whole point of the regression
  });
});

function parseHexForTest(hex: string) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

describe("HSL round-trip", () => {
  it("preserves a colour through rgbToHsl then hslToRgb within rounding tolerance", () => {
    const original = { r: 107, g: 143, b: 113 };
    const roundTripped = hslToRgb(rgbToHsl(original));

    expect(roundTripped.r).toBeCloseTo(original.r, 0);
    expect(roundTripped.g).toBeCloseTo(original.g, 0);
    expect(roundTripped.b).toBeCloseTo(original.b, 0);
  });

  it("preserves hue and saturation while lightness alone changes", () => {
    const original = rgbToHsl({ r: 107, g: 143, b: 113 });
    const lightened = { ...original, l: 0.9 };
    const result = rgbToHsl(hslToRgb(lightened));

    expect(result.h).toBeCloseTo(original.h, 0);
    expect(result.s).toBeCloseTo(original.s, 1);
  });

  it("handles achromatic (grey) colours without divide-by-zero", () => {
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 128 / 255 });
    expect(hslToRgb({ h: 0, s: 0, l: 0.5 })).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
  });
});
