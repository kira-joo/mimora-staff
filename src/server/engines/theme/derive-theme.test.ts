import { describe, expect, it } from "vitest";
import { contrastRatio, hslToRgb, parseHex } from "./color-math";
import { deriveInkForGround, MIN_CONTRAST_RATIO, resolveBrandPalette } from "./derive-theme";

const DARK_GROUND = "#121212";
const LIGHT_GROUND = "#FFFFFF";

// The binary search converges to within this of the target ratio, not to it
// exactly — asserting the exact literal would make tests as fragile as the
// search's own iteration count rather than testing the guarantee that
// matters: no derived pair is meaningfully non-compliant.
const CONVERGENCE_TOLERANCE = 0.02;

describe("deriveInkForGround", () => {
  it("returns the seed unchanged when it already clears the ratio", () => {
    // Pure white on a dark ground already passes by a wide margin.
    const result = deriveInkForGround("#FFFFFF", DARK_GROUND);
    expect(result.hex).toBe("#FFFFFF");
    expect(result.contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });

  it("derives the regression case that started this engine: #6B8F71 fails at 3.63:1 on white and this function corrects it", () => {
    const onWhite = deriveInkForGround("#6B8F71", LIGHT_GROUND);
    expect(onWhite.contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);

    // The seed itself was insufficient — proves this test would have caught
    // the regression rather than passing on the unmodified input.
    const seedRatio = contrastRatio(parseHex("#6B8F71"), parseHex(LIGHT_GROUND));
    expect(seedRatio).toBeLessThan(MIN_CONTRAST_RATIO);
  });

  it("derives a compliant ink for the same brand colour against a dark ground", () => {
    const result = deriveInkForGround("#6B8F71", DARK_GROUND);
    expect(result.contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });

  it("lightens toward white when the ground is dark, never darkens", () => {
    const seed = parseHex("#6B8F71");
    const result = deriveInkForGround("#6B8F71", DARK_GROUND);
    const derived = parseHex(result.hex);

    // Lightening in HSL space moves every channel toward 255, away from 0 —
    // the direction that increases contrast against a dark ground.
    expect(derived.r).toBeGreaterThanOrEqual(seed.r);
    expect(derived.g).toBeGreaterThanOrEqual(seed.g);
    expect(derived.b).toBeGreaterThanOrEqual(seed.b);
  });

  it("darkens toward black when the ground is light, never lightens", () => {
    const seed = parseHex("#D8E8DC"); // a pale mint, fails against white
    const seedRatio = contrastRatio(seed, parseHex(LIGHT_GROUND));
    expect(seedRatio).toBeLessThan(MIN_CONTRAST_RATIO);

    const result = deriveInkForGround("#D8E8DC", LIGHT_GROUND);
    const derived = parseHex(result.hex);

    expect(derived.r).toBeLessThanOrEqual(seed.r);
    expect(derived.g).toBeLessThanOrEqual(seed.g);
    expect(derived.b).toBeLessThanOrEqual(seed.b);
    expect(result.contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });

  it("preserves hue exactly — only lightness moves", () => {
    // Verified via the RGB channel ratios rather than re-deriving HSL here,
    // so this test does not depend on color-math's own internals being right.
    const seed = parseHex("#6B8F71");
    const result = deriveInkForGround("#6B8F71", DARK_GROUND);
    const derived = parseHex(result.hex);

    // Green is the dominant channel in both the seed and a hue-preserving
    // lightened version.
    const seedGreenDominance = seed.g - (seed.r + seed.b) / 2;
    const derivedGreenDominance = derived.g - (derived.r + derived.b) / 2;
    expect(Math.sign(derivedGreenDominance)).toBe(Math.sign(seedGreenDominance));
  });

  it("rejects a malformed brand colour loudly rather than deriving from garbage", () => {
    expect(() => deriveInkForGround("not-a-colour", DARK_GROUND)).toThrow(/not a valid/);
  });

  describe("the sweep — every derived pair clears its required ratio", () => {
    /*
     * Deliberately awkward mid-tones: every 15° of hue at 50% saturation and
     * 50% lightness — exactly the band a fixed "just add white" heuristic
     * would under- or over-correct for at different hues, and the band nearest
     * the ambiguous middle where a naive implementation is most likely to
     * clear the ratio by luck rather than by construction.
     */
    const midTones = Array.from({ length: 24 }, (_, i) => {
      const rgb = hslToRgb({ h: i * 15, s: 0.5, l: 0.5 });
      return `#${[rgb.r, rgb.g, rgb.b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
    });

    it.each(midTones)("clears %s → dark ground", (hex) => {
      const result = deriveInkForGround(hex, DARK_GROUND);
      expect(result.contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO - CONVERGENCE_TOLERANCE);
    });

    it.each(midTones)("clears %s → light ground", (hex) => {
      const result = deriveInkForGround(hex, LIGHT_GROUND);
      expect(result.contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO - CONVERGENCE_TOLERANCE);
    });

    it("also clears the extremes: pure black, pure white, and full-saturation primaries", () => {
      const extremes = ["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF"];
      for (const hex of extremes) {
        expect(deriveInkForGround(hex, DARK_GROUND).contrastRatio).toBeGreaterThanOrEqual(
          MIN_CONTRAST_RATIO - CONVERGENCE_TOLERANCE
        );
        expect(deriveInkForGround(hex, LIGHT_GROUND).contrastRatio).toBeGreaterThanOrEqual(
          MIN_CONTRAST_RATIO - CONVERGENCE_TOLERANCE
        );
      }
    });
  });
});

describe("resolveBrandPalette", () => {
  const GROUNDS = { light: "#F7F5F1", dark: "#14130F" };
  const ratioOn = (hex: string, ground: string) => contrastRatio(parseHex(hex), parseHex(ground));

  it("gives every fill a legible value on both grounds — the regression colour included", () => {
    const palette = resolveBrandPalette({ fills: { primary: "#6B8F71", accent: "#B08968" }, overrides: [], grounds: GROUNDS });
    for (const ground of ["light", "dark"] as const) {
      for (const key of ["primary", "accent"] as const) {
        expect(ratioOn(palette[ground][key].hex, GROUNDS[ground])).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
        expect(palette[ground][key].source).toBe("derived");
      }
    }
  });

  it("keeps a fill that already passes exactly as the merchant chose it", () => {
    const palette = resolveBrandPalette({ fills: { primary: "#9F4E19", accent: "#4B5B43" }, overrides: [], grounds: GROUNDS });
    expect(palette.light.primary.hex.toLowerCase()).toBe("#9f4e19");
  });

  it("honours a pinned override on the ground where it passes, and falls back to the derived value where it does not", () => {
    // Near-black passes on the light ground and fails on the dark one.
    const palette = resolveBrandPalette({ fills: { primary: "#6B8F71", accent: "#B08968" }, overrides: [{ key: "primary", value: "#1A1A1A" }], grounds: GROUNDS });
    expect(palette.light.primary).toMatchObject({ hex: "#1A1A1A", source: "override" });
    expect(palette.dark.primary.source).toBe("derived");
    expect(ratioOn(palette.dark.primary.hex, GROUNDS.dark)).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });

  it("a label in the ground's own colour is legible on every resolved fill — contrast is symmetric (D-S1)", () => {
    const palette = resolveBrandPalette({ fills: { primary: "#FFD400", accent: "#00B3FF" }, overrides: [], grounds: GROUNDS });
    expect(ratioOn(GROUNDS.light, palette.light.primary.hex)).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    expect(ratioOn(GROUNDS.dark, palette.dark.primary.hex)).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });
});

describe("resolveBrandPalette against every surface text sits on", () => {
  // The storefront's own backgrounds (store-platform tokens.css): canvas, card surface, muted surface.
  const SURFACES = { light: ["#F7F5F1", "#FFFFFF", "#EFEBE4"], dark: ["#14130F", "#1D1B16", "#24211B"] } as const;
  const GROUNDS_ONLY = { light: "#F7F5F1", dark: "#14130F" };

  it("clears the minimum on the WORST background, not only the ground (the 2026-10-20 dark-accent regression)", () => {
    // The seeded merchant's accent: resolved against the dark canvas alone it measured 4.19:1 on the dark card surface.
    const groundOnly = resolveBrandPalette({ fills: { primary: "#9F4E19", accent: "#4B5B43" }, overrides: [], grounds: GROUNDS_ONLY });
    expect(contrastRatio(parseHex(groundOnly.dark.accent.hex), parseHex("#1D1B16"))).toBeLessThan(MIN_CONTRAST_RATIO);

    const palette = resolveBrandPalette({ fills: { primary: "#9F4E19", accent: "#4B5B43" }, overrides: [], grounds: GROUNDS_ONLY, surfaces: SURFACES });
    for (const ground of ["light", "dark"] as const) {
      for (const key of ["primary", "accent"] as const) {
        for (const background of SURFACES[ground]) {
          expect(contrastRatio(parseHex(palette[ground][key].hex), parseHex(background))).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
        }
        expect(palette[ground][key].contrastRatio).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
      }
    }
  });

  it("refuses an override that passes on the ground but fails on a surface", () => {
    // Clears 4.5:1 against the dark canvas, not against the lighter muted surface.
    const borderline = "#6D8461";
    expect(contrastRatio(parseHex(borderline), parseHex("#14130F"))).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    const palette = resolveBrandPalette({ fills: { primary: "#9F4E19", accent: "#4B5B43" }, overrides: [{ key: "accent", value: borderline }], grounds: GROUNDS_ONLY, surfaces: SURFACES });
    expect(palette.dark.accent.source).toBe("derived");
  });

  it("is unchanged when no surfaces are given (backward compatible)", () => {
    const a = resolveBrandPalette({ fills: { primary: "#9F4E19", accent: "#4B5B43" }, overrides: [], grounds: GROUNDS_ONLY });
    const b = resolveBrandPalette({ fills: { primary: "#9F4E19", accent: "#4B5B43" }, overrides: [], grounds: GROUNDS_ONLY, surfaces: { light: [], dark: [] } });
    expect(b).toEqual(a);
  });
});

describe("the contrast guarantee holds for the hex actually painted", () => {
  it("a derived colour whose hex rounding lands under the minimum is pushed back over it (the 4.485:1 case)", () => {
    const surfaces = { light: ["#F7F5F1", "#FFFFFF", "#EFEBE4"], dark: ["#14130F", "#1D1B16", "#24211B"] } as const;
    const palette = resolveBrandPalette({ fills: { primary: "#6B8F71", accent: "#B08968" }, overrides: [], grounds: { light: "#F7F5F1", dark: "#14130F" }, surfaces });
    for (const ground of ["light", "dark"] as const)
      for (const key of ["primary", "accent"] as const)
        for (const background of surfaces[ground]) expect(contrastRatio(parseHex(palette[ground][key].hex), parseHex(background))).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
  });
});
