import type { OptionAxis } from "src/api/products.endpoints";
import type { BackorderPolicy, CreateVariantInput, Variant, VariantInput } from "src/api/variants.endpoints";

/** Every field as the form holds it — text, so an empty optional field is "" rather than 0. */
export interface VariantFormValues {
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  price: string;
  compareAtPrice: string;
  costPrice: string;
  stock: string;
  lowStockThreshold: string;
  /** `DEFAULT` (create only): send nothing and the store's default inventory policy applies. */
  backorderPolicy: BackorderPolicy | "DEFAULT";
  unitOfMeasure: string;
  unitsPerSale: string;
  weight: string;
  length: string;
  width: string;
  height: string;
}

export const UNIT_OPTIONS = [
  { value: "EACH", label: "Each" },
  { value: "PACK", label: "Pack" },
  { value: "BOX", label: "Box" },
];

const text = (value: number | string | undefined) => (value === undefined || value === null ? "" : String(value));

/**
 * API shape → form values, against the product's current axes: one option
 * value per axis, in the axes' order, keeping any value the variant already
 * has. No variant → the create defaults.
 */
export function mapVariantToFormValues(axes: readonly OptionAxis[], oldData?: Variant): VariantFormValues {
  const current = new Map((oldData?.optionValues ?? []).map((option) => [option.key, option.value]));
  return {
    sku: oldData?.sku ?? "",
    optionValues: axes.map((axis) => ({ key: axis.key, value: current.get(axis.key) ?? "" })),
    price: oldData?.price ?? "",
    compareAtPrice: oldData?.compareAtPrice ?? "",
    costPrice: oldData?.costPrice ?? "",
    stock: oldData ? text(oldData.stock) : "0",
    lowStockThreshold: text(oldData?.lowStockThreshold),
    backorderPolicy: oldData?.backorderPolicy ?? "DEFAULT",
    unitOfMeasure: oldData?.unitOfMeasure ?? "EACH",
    unitsPerSale: text(oldData?.unitsPerSale ?? 1),
    weight: text(oldData?.weight),
    length: text(oldData?.length),
    width: text(oldData?.width),
    height: text(oldData?.height),
  };
}

// CustomForm drops an empty number-type input before transformValues runs, so a blank optional field arrives as "" or not at all.
const optional = (value: string | undefined) => (value === undefined || value.trim() === "" ? undefined : value.trim());
// Whole counts and measurements, not money: converting them to numbers is safe.
const optionalNumber = (value: string | number | undefined) => {
  const text = optional(value === undefined ? undefined : String(value));
  return text === undefined ? undefined : Number(text);
};

/** The shared body for create and update. Money stays a string. */
export function variantBody(values: VariantFormValues): VariantInput {
  return {
    sku: values.sku.trim(),
    // A product without options renders no option field, so the form drops `optionValues` entirely — absent means none.
    optionValues: (values.optionValues ?? []).map((option) => ({ key: option.key, value: option.value.trim() })),
    price: values.price.trim(),
    compareAtPrice: optional(values.compareAtPrice),
    costPrice: optional(values.costPrice),
    lowStockThreshold: optionalNumber(values.lowStockThreshold),
    // "DEFAULT" is "no choice": the server stores the store's default policy as it is at creation.
    backorderPolicy: values.backorderPolicy === "DEFAULT" ? undefined : values.backorderPolicy,
    unitOfMeasure: values.unitOfMeasure,
    unitsPerSale: optionalNumber(values.unitsPerSale),
    weight: optionalNumber(values.weight),
    length: optionalNumber(values.length),
    width: optionalNumber(values.width),
    height: optionalNumber(values.height),
  };
}

export const createVariantBody = (productId: string, values: VariantFormValues): CreateVariantInput => ({
  ...variantBody(values),
  productId,
  stock: Number(values.stock),
});

/** "Olive · M" — the variant's values in the product's axis order. */
export function optionSummary(axes: readonly OptionAxis[], variant: Pick<Variant, "optionValues">): string {
  const byKey = new Map(variant.optionValues.map((option) => [option.key, option.value]));
  const ordered = axes.map((axis) => byKey.get(axis.key)).filter((value): value is string => Boolean(value));
  // Values whose axis was since removed from the product still show, after the rest.
  const orphans = variant.optionValues.filter((option) => !axes.some((axis) => axis.key === option.key)).map((option) => option.value);
  return [...ordered, ...orphans].join(" · ");
}

export const WHOLE_NUMBER = /^\d+$/;
export const MEASUREMENT = /^\d+(\.\d+)?$/;
