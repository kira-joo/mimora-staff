/** A parsed sRGB colour, channels 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Hue in degrees [0, 360), saturation and lightness as fractions [0, 1]. */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const HEX_PATTERN = /^#?([0-9a-fA-F]{6})$/;
const SHORTHAND_PATTERN = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;

/**
 * `#RGB` → `#RRGGBB` (each digit doubled, as CSS reads it); anything else is
 * returned untouched for `parseHex` to accept or refuse. The theme DTO
 * applies this at the boundary, so the engine — and every stored colour —
 * only ever sees six digits.
 */
export function expandHexShorthand(hex: string): string {
  const match = SHORTHAND_PATTERN.exec(hex.trim());
  return match ? `#${match[1]!.repeat(2)}${match[2]!.repeat(2)}${match[3]!.repeat(2)}` : hex;
}

/** Throws on anything that isn't a well-formed 6-digit hex colour — a malformed brand fill is a data problem to surface, not to silently coerce. */
export function parseHex(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) throw new Error(`"${hex}" is not a valid 6-digit hex colour.`);

  const value = match[1]!;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let h: number;
  if (max === rN) h = ((gN - bN) / delta) % 6;
  else if (max === gN) h = (bN - rN) / delta + 2;
  else h = (rN - gN) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;

  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const value = l * 255;
    return { r: value, g: value, b: value };
  }

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];

  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/** WCAG relative luminance — https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const linear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, always ≥ 1 regardless of argument order. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const lA = relativeLuminance(a);
  const lB = relativeLuminance(b);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
