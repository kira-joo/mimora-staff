import { MIN_CONTRAST_RATIO, resolveBrandPalette, type BrandFillKey, type ResolvedFill } from "../../engines/theme/derive-theme";
import { upsertSingletonSettings } from "../settings/singleton-settings";
import { storeProfileRepository } from "../../core/repositories";
import { STOREFRONT_GROUNDS, STOREFRONT_SURFACES, type StorefrontGround } from "../../content/storefront-grounds";
import type { StoreProfileSchema } from "../../content/store-profile.schema";
import type { UpdateThemeDto } from "../dto/update-theme.dto";

export interface ContrastMeasurement {
  label: string;
  /** What the merchant entered — the brand fill, or the pinned override. */
  fillHex: string;
  groundHex: string;
  /** What the storefront will actually paint on this ground. */
  derivedInkHex: string;
  contrastRatio: number;
  meetsMinimum: boolean;
  source: ResolvedFill["source"];
}

export interface UpdateThemeResult {
  profile: StoreProfileSchema;
  contrastReport: Record<`${StorefrontGround}Ground`, ContrastMeasurement[]>;
}

/**
 * Writes `StoreProfile.brand`/`theme` and reports, for each brand fill on
 * **each storefront ground** (`STOREFRONT_GROUNDS` — the design system's own
 * `--sf-canvas` values, never the merchant's free-text `brand.surface`),
 * what the storefront will paint and the ratio it measures — MDS §20's
 * "shows the measured ratio for each pair it is about to write".
 *
 * **Never rejects on contrast and never rewrites a submitted value.** The
 * resolution always yields a legible colour (`resolveBrandPalette`): an
 * override that fails on a ground falls back to the derived value there,
 * and the report says so (`source: "derived"`) so the theme screen can show
 * the merchant which of their choices was adjusted, and where.
 */
export async function updateTheme(dto: UpdateThemeDto): Promise<UpdateThemeResult> {
  const palette = resolveBrandPalette({ fills: { primary: dto.brand.primary, accent: dto.brand.accent }, overrides: dto.theme.tokenOverrides, grounds: STOREFRONT_GROUNDS, surfaces: STOREFRONT_SURFACES });

  const report = (ground: StorefrontGround): ContrastMeasurement[] =>
    (["primary", "accent"] as BrandFillKey[]).map((key) => {
      const resolved = palette[ground][key];
      const override = dto.theme.tokenOverrides.find((candidate) => candidate.key === key);
      return {
        label: override ? `theme.tokenOverrides[${key}]` : `brand.${key}`,
        fillHex: override?.value ?? dto.brand[key],
        groundHex: STOREFRONT_GROUNDS[ground],
        derivedInkHex: resolved.hex,
        contrastRatio: resolved.contrastRatio,
        meetsMinimum: resolved.contrastRatio >= MIN_CONTRAST_RATIO,
        source: resolved.source,
      };
    });

  const profile = await upsertSingletonSettings(storeProfileRepository, { brand: dto.brand, theme: dto.theme });

  return { profile, contrastReport: { lightGround: report("light"), darkGround: report("dark") } };
}
