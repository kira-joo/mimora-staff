import { contrastRatio, parseHex } from "src/server/engines/theme/color-math";
import { deriveInkForGround, MIN_CONTRAST_RATIO } from "src/server/engines/theme/derive-theme";
import { isHexColor } from "./settings-helpers";

export { MIN_CONTRAST_RATIO };

export interface FillMeasurement {
  /** The fill as the owner entered it. */
  fillHex: string;
  /** The fill used directly as text on the ground. */
  fillRatio: number;
  /** The ink the storefront will actually use for this fill (the fill itself when it already clears the floor). */
  inkHex: string;
  inkRatio: number;
  /** `true` when the fill alone fails and the storefront will use a derived ink instead. */
  adjusted: boolean;
}

/**
 * What the storefront will do with one brand fill on the light ground, using the backend's own engine —
 * no colour math lives here. `null` while either value is not yet a complete hex (the owner is mid-typing).
 */
export function measureFill(fillHex: string, groundHex: string): FillMeasurement | null {
  if (!isHexColor(fillHex) || !isHexColor(groundHex)) return null;
  const fill = fillHex.trim();
  const ground = groundHex.trim();
  const ink = deriveInkForGround(fill, ground);
  const fillRatio = contrastRatio(parseHex(fill), parseHex(ground));
  return { fillHex: fill, fillRatio, inkHex: ink.hex, inkRatio: ink.contrastRatio, adjusted: fillRatio < MIN_CONTRAST_RATIO };
}

/** Informational only (the API never derives or gates body text): how readable `text` is on `surface`. */
export function measureText(textHex: string, surfaceHex: string): { ratio: number; meetsMinimum: boolean } | null {
  if (!isHexColor(textHex) || !isHexColor(surfaceHex)) return null;
  const ratio = contrastRatio(parseHex(textHex.trim()), parseHex(surfaceHex.trim()));
  return { ratio, meetsMinimum: ratio >= MIN_CONTRAST_RATIO };
}
