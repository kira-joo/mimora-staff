import type { OptionAxis, OptionAxisValue, ProductAttribute } from "src/api/products.endpoints";

const blankText = () => ({ ar: "", en: "" });

export const newAxis = (): OptionAxis => ({ key: "", name: blankText(), values: [] });
export const newAxisValue = (): OptionAxisValue => ({ key: "", label: blankText() });
export const newAttribute = (): ProductAttribute => ({ key: "", name: blankText(), values: [{ key: "", value: blankText() }] });

/**
 * A suggested machine key from a display name: lowercase Latin letters,
 * digits and dashes. Arabic-only names give nothing — staff type the key.
 */
export function suggestKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

const KEY_MAX = 50;

function keyProblem(keys: string[], noun: string): string | undefined {
  if (keys.some((key) => !key.trim())) return `Every ${noun} needs a key.`;
  if (keys.some((key) => key.trim().length > KEY_MAX)) return `Keep ${noun} keys to ${KEY_MAX} characters.`;
  const lower = keys.map((key) => key.trim().toLowerCase());
  if (new Set(lower).size !== lower.length) return `Two ${noun}s share a key.`;
  return undefined;
}

const named = (name: { ar: string; en: string }) => Boolean(name.en.trim() || name.ar.trim());

const SWATCH = /^#[0-9A-Fa-f]{6}$/;

/** Why the option axes can't be saved, or `undefined`. Mirrors the DTO's limits (key required, ≤ 50) plus uniqueness, which variants rely on. */
export function axesProblem(axes: readonly OptionAxis[]): string | undefined {
  const own =
    keyProblem(
      axes.map((axis) => axis.key),
      "option",
    ) ?? (axes.some((axis) => !named(axis.name)) ? "Every option needs a name in at least one language." : undefined);
  if (own) return own;
  for (const axis of axes) {
    const values = axis.values ?? [];
    const problem = keyProblem(
      values.map((value) => value.key),
      "value",
    );
    if (problem) return `${axis.name.en || axis.name.ar || axis.key}: ${problem}`;
    // A value key becomes part of a variant's identity (`colour=red|size=m`) and of the import's cell format, so those separators are out.
    if (values.some((value) => /[|=;]/.test(value.key))) return `${axis.name.en || axis.name.ar || axis.key}: a value key may not contain | = or ;.`;
    if (values.some((value) => value.swatch && !SWATCH.test(value.swatch))) return `${axis.name.en || axis.name.ar || axis.key}: a swatch must be a #RRGGBB colour.`;
  }
  return undefined;
}

export function attributesProblem(attributes: readonly ProductAttribute[]): string | undefined {
  const own = keyProblem(
    attributes.map((attribute) => attribute.key),
    "attribute",
  );
  if (own) return own;
  if (attributes.some((attribute) => !named(attribute.name))) return "Every attribute needs a name in at least one language.";
  for (const attribute of attributes) {
    if (attribute.values.length === 0) return "Every attribute needs at least one value.";
    const values = keyProblem(
      attribute.values.map((value) => value.key),
      "value",
    );
    if (values) return values;
    if (attribute.values.some((value) => !named(value.value))) return "Every attribute value needs a label in at least one language.";
  }
  return undefined;
}

/**
 * Trims keys and text before saving. An option's values are kept — dropping them here would silently erase the labels and
 * swatches every time a product is saved. A value with no label in a language reads as its own key there, so a label is
 * never blank in the store's default language.
 */
export function cleanAxes(axes: readonly OptionAxis[]): OptionAxis[] {
  return axes.map((axis) => {
    const values = (axis.values ?? []).map((value) => {
      const key = value.key.trim();
      return { key, label: { ar: value.label.ar.trim() || key, en: value.label.en.trim() || key }, ...(value.swatch?.trim() ? { swatch: value.swatch.trim() } : {}) };
    });
    return { key: axis.key.trim(), name: { ar: axis.name.ar.trim(), en: axis.name.en.trim() }, ...(values.length > 0 ? { values } : {}) };
  });
}

export function cleanAttributes(attributes: readonly ProductAttribute[]): ProductAttribute[] {
  return attributes.map((attribute) => ({
    key: attribute.key.trim(),
    name: { ar: attribute.name.ar.trim(), en: attribute.name.en.trim() },
    values: attribute.values.map((value) => ({ key: value.key.trim(), value: { ar: value.value.ar.trim(), en: value.value.en.trim() } })),
  }));
}
