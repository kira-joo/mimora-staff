import type { ImageAsset, LocalizedString } from "@kira-joo/toolkit-common";

export interface QuoteOptionLabel {
  axis: LocalizedString;
  value: LocalizedString;
}

interface AxisDefinition {
  key: string;
  name: LocalizedString;
  values?: Array<{ key: string; label: LocalizedString }>;
}

/**
 * "Colour: Olive · Size: M" in either locale: each variant option's axis name
 * and value label come from the product's axis definitions. A key with no
 * definition (an axis since removed, or a value the merchant never labelled)
 * falls back to the raw key in both locales, so the cart never shows nothing.
 */
export function resolveOptionLabels(optionValues: Array<{ key: string; value: string }>, axes: AxisDefinition[]): QuoteOptionLabel[] {
  return optionValues.map((option) => {
    const axis = axes.find((candidate) => candidate.key === option.key);
    const label = axis?.values?.find((candidate) => candidate.key === option.value)?.label;
    return {
      axis: axis?.name ?? { en: option.key, ar: option.key },
      value: label ?? { en: option.value, ar: option.value },
    };
  });
}

/** The variant's own gallery wins; otherwise the product's primary (first) image; otherwise none. */
export function resolveLineImage(variantGallery: ImageAsset[] | undefined, productImages: ImageAsset[]): ImageAsset | null {
  return variantGallery?.[0] ?? productImages[0] ?? null;
}
