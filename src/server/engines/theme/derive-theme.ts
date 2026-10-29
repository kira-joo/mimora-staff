import { contrastRatio, hslToRgb, parseHex, relativeLuminance, rgbToHsl, toHex, type Rgb } from "./color-math";

/** WCAG AA for normal-weight text — the floor this platform guarantees. */
export const MIN_CONTRAST_RATIO = 4.5;

/** Binary search stops once within this fraction of the target ratio — far tighter than any perceptible difference. */
const CONVERGENCE_EPSILON = 0.01;
const MAX_ITERATIONS = 40;

export interface DerivedInk {
  hex: string;
  contrastRatio: number;
}

/**
 * Derives a colour guaranteed to clear `minRatio` against `groundHex`,
 * starting from a merchant-supplied brand fill and preserving its hue and
 * saturation exactly — only lightness moves.
 *
 * **The failure cannot occur, rather than being caught.** A validate-and-reject
 * design was rejected for this platform after `#6B8F71` on white measured
 * 3.63:1 and failed 16 nodes across 8 routes the moment a second store
 * rendered with it — the first store's colour happened to pass, which is
 * exactly why the defect had never surfaced. Deriving instead of validating
 * means there is no brand colour a merchant can enter that produces illegible
 * text: this function always returns a compliant value.
 *
 * **Why this always converges.** Pushing lightness to its extreme (white
 * against a dark ground, black against a light one) always reaches the
 * maximum possible contrast ratio for that hue — the input color's saturation
 * decays toward the extreme but its ratio only ever increases along that
 * search direction. So a binary search on lightness alone, in the direction
 * away from the ground, is monotonic and always has a solution to find,
 * for every parseable colour. **A colour that cannot yield a compliant
 * palette is not a real case** — the only way this function fails is a
 * malformed hex string, which it rejects loudly via `parseHex` rather than
 * silently deriving from a garbage value.
 */
export function deriveInkForGround(brandFillHex: string, groundHex: string, minRatio = MIN_CONTRAST_RATIO): DerivedInk {
  const ground = parseHex(groundHex);
  const seed = parseHex(brandFillHex);

  const seedRatio = contrastRatio(seed, ground);
  if (seedRatio >= minRatio) {
    return { hex: toHex(seed), contrastRatio: seedRatio };
  }

  const groundIsDark = relativeLuminance(ground) < 0.5;
  const hsl = rgbToHsl(seed);

  // Search the lightness range between the seed's own lightness and the
  // extreme that increases contrast against this ground.
  let low = groundIsDark ? hsl.l : 0;
  let high = groundIsDark ? 1 : hsl.l;

  let best: Rgb = hslToRgb({ ...hsl, l: groundIsDark ? 1 : 0 });
  let bestRatio = contrastRatio(best, ground);

  if (bestRatio < minRatio) {
    // Pure white/black at this hue's saturation still doesn't clear the bar —
    // cannot happen for any real hue/saturation pair, since desaturating
    // toward white or black converges to the same extreme regardless of
    // starting saturation. Fail loudly rather than return a non-compliant
    // value silently.
    throw new Error(
      `No lightness adjustment of "${brandFillHex}" clears a ${minRatio}:1 ratio against "${groundHex}". This should be unreachable — investigate rather than relaxing the ratio.`
    );
  }

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const mid = (low + high) / 2;
    const candidate = hslToRgb({ ...hsl, l: mid });
    const ratio = contrastRatio(candidate, ground);

    if (ratio >= minRatio) {
      best = candidate;
      bestRatio = ratio;
      // This is a passing candidate — try to move back toward the seed's
      // original lightness for the smallest change that still passes.
      if (groundIsDark) high = mid;
      else low = mid;
    } else if (groundIsDark) {
      low = mid;
    } else {
      high = mid;
    }

    if (Math.abs(ratio - minRatio) <= CONVERGENCE_EPSILON) break;
  }

  return { hex: toHex(best), contrastRatio: bestRatio };
}

export type BrandFillKey = "primary" | "accent";

export interface BrandPaletteInput {
  fills: Record<BrandFillKey, string>;
  /** Exact values the merchant pinned (`theme.tokenOverrides[]`) — honoured only on a ground where they already pass. */
  overrides: Array<{ key: BrandFillKey; value: string }>;
  grounds: { light: string; dark: string };
  /**
   * Every background the colour is read on, per ground (the ground itself
   * included). When given, a resolved fill clears the minimum against the WORST
   * of them — not just the ground. Absent: the ground alone, as before.
   */
  surfaces?: { light: readonly string[]; dark: readonly string[] };
}

export interface ResolvedFill {
  /** The colour the storefront paints — links, the CTA fill. Clears `MIN_CONTRAST_RATIO` against this ground. */
  hex: string;
  contrastRatio: number;
  /** Where `hex` came from: the merchant's pinned override, or the derivation from their brand fill. */
  source: "override" | "derived";
}

export type BrandPalette = Record<"light" | "dark", Record<BrandFillKey, ResolvedFill>>;

/**
 * The storefront's brand colours on both grounds (D-2, D-S1). Each fill is
 * derived from the merchant's brand colour against the ground; a pinned
 * override replaces the derived value only on a ground where it clears the
 * minimum itself, and falls back to the derived value on the other —
 * "validated against both grounds, falling back to the derived value on
 * failure". Every value returned is legible on its ground by construction,
 * and because contrast is symmetric, so is a label in the ground's own
 * colour set on that fill (design-system.md §7a).
 */
export function resolveBrandPalette(input: BrandPaletteInput, minRatio = MIN_CONTRAST_RATIO): BrandPalette {
  const resolveOn = (groundHex: string, surfaces: readonly string[]): Record<BrandFillKey, ResolvedFill> => {
    const backgrounds = surfaces.length > 0 ? surfaces : [groundHex];
    // The background a colour reads worst on — the one its contrast is lowest against.
    const worst = (hex: string) =>
      backgrounds.reduce(
        (lowest, background) => {
          const ratio = contrastRatio(parseHex(hex), parseHex(background));
          return ratio < lowest.ratio ? { background, ratio } : lowest;
        },
        { background: backgrounds[0]!, ratio: Number.POSITIVE_INFINITY }
      );

    const resolve = (key: BrandFillKey): ResolvedFill => {
      const override = input.overrides.find((candidate) => candidate.key === key);
      if (override) {
        const { ratio } = worst(override.value);
        if (ratio >= minRatio) return { hex: toHex(parseHex(override.value)), contrastRatio: ratio, source: "override" };
      }
      /*
       * Derive away from the worst background. Every other background of the ground lies further in the same
       * direction, so clearing the worst clears them all. The guarantee is measured on the HEX that will be
       * painted: rounding a derived colour to hex can land a hair under the target (measured: 4.485:1 against
       * the muted surface), so a short result is re-derived against a slightly raised target until it clears.
       */
      let hex = input.fills[key];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const target = worst(hex);
        if (target.ratio >= minRatio) break;
        hex = deriveInkForGround(hex, target.background, minRatio + attempt * 0.02).hex;
      }
      return { hex, contrastRatio: worst(hex).ratio, source: "derived" };
    };
    return { primary: resolve("primary"), accent: resolve("accent") };
  };

  return {
    light: resolveOn(input.grounds.light, input.surfaces?.light ?? []),
    dark: resolveOn(input.grounds.dark, input.surfaces?.dark ?? []),
  };
}
