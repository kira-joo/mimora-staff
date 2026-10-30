import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { storeProfileRepository } from "../core/repositories";
import { resolveBrandPalette, type BrandPalette } from "../engines/theme/derive-theme";
import { STOREFRONT_GROUNDS, STOREFRONT_SURFACES } from "../content/storefront-grounds";
import type { StoreProfileSchema } from "../content/store-profile.schema";

export interface ThemeView {
  brand: StoreProfileSchema["brand"];
  theme: StoreProfileSchema["theme"];
  /** The colours to paint, per ground — the storefront never derives them itself (business logic stays here). */
  palette: BrandPalette;
  /** The grounds `palette` was resolved against; the storefront's contrast gate asserts its own tokens equal these. */
  grounds: typeof STOREFRONT_GROUNDS;
}

/**
 * The merchant's theme as the storefront applies it: the stored brand and
 * theme switches, plus the brand colours resolved on both grounds (D-2,
 * D-S1) so the primary call to action uses the merchant's colour at a
 * guaranteed-legible value. The dark palette is returned whether or not
 * `darkEnabled` — the storefront decides whether to apply a ground; it
 * does not decide what colours a ground has.
 */
export async function getTheme(): Promise<ThemeView> {
  const profile = await storeProfileRepository.findOne({ where: {}, select: { brand: true, theme: true }, skipThrowError: true, lean: true });
  if (!profile) throw new NotFoundError("Store profile is not configured.");

  const palette = resolveBrandPalette({ fills: { primary: profile.brand.primary, accent: profile.brand.accent }, overrides: profile.theme.tokenOverrides ?? [], grounds: STOREFRONT_GROUNDS, surfaces: STOREFRONT_SURFACES });

  // Named keys, not a spread: a profile saved before `typographyChoice` was removed still stores it, and the
  // storefront must never receive a typography setting again (Mimora's fonts are fixed in its code).
  const { primary, accent, surface, text, radiusScale } = profile.brand;
  return { brand: { primary, accent, surface, text, radiusScale }, theme: profile.theme, palette, grounds: STOREFRONT_GROUNDS };
}
