import type { FormFieldConfig, FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import type { FieldValues } from "react-hook-form";

/**
 * `#RRGGBB` only — a subset of what the API takes (it also expands `#RGB`), kept because the colour swatches and the
 * contrast preview read the six-digit form.
 */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** A non-negative whole number as typed. Whether it is in range is the field's `min`/the server's call. */
export const WHOLE_NUMBER = /^\d+$/;

/**
 * Three letters. The API only caps the length (10), but the console formats every amount with this code
 * (`Intl`), and a code that is not well-formed there throws on every page, so it is refused here first.
 */
export const CURRENCY_CODE = /^[A-Za-z]{3}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value.trim());
}

/** `""`/whitespace becomes `undefined` (field omitted from the body); a whole number becomes a number. */
export function toOptionalWholeNumber(text: string | undefined): number | undefined {
  const value = (text ?? "").trim();
  return WHOLE_NUMBER.test(value) ? Number(value) : undefined;
}

export function blankToUndefined(text: string | undefined): string | undefined {
  const value = (text ?? "").trim();
  return value === "" ? undefined : value;
}

/** `"owner, manager ,,owner"` -> `["owner", "manager"]`: trimmed, empties dropped, first occurrence kept. */
export function splitList(text: string | undefined): string[] {
  const seen = new Set<string>();
  for (const part of (text ?? "").split(",")) {
    const item = part.trim();
    if (item) seen.add(item);
  }
  return [...seen];
}

export function joinList(items: readonly string[] | undefined): string {
  return (items ?? []).join(", ");
}

/**
 * A read-only role still sees every value: the same form, every field disabled.
 * (A CUSTOM field renders its own controls, so it reads `disabled` from its own closure instead.)
 */
export function disableFields<T extends FieldValues>(sections: FormSection<T>[], disabled: boolean): FormSection<T>[] {
  if (!disabled) return sections;
  return sections.map((section) => ({ ...section, fields: section.fields.map((field): FormFieldConfig<T> => ({ ...field, disabled: true })) }));
}
