import { buildVariantKey } from "./variant-key";

export interface RowProblem {
  /** Zero-based position in the submitted list. */
  index: number;
  /** Field within the row: `sku`, `optionValues`, `id`. */
  field: string;
  message: string;
}

export interface CreateRowInput {
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
}

/**
 * Every problem in a batch of variants to create, found before anything is written, so a person fixing the
 * grid sees all of them at once instead of one refusal per attempt. Pure: the caller supplies what already
 * exists. The same three rules `createVariant` enforces one row at a time — option values match the product's
 * axes exactly, SKU unique, one variant per axis combination (`variantKey`) — extended across the batch itself,
 * where two rows can collide with each other rather than with the database.
 *
 * A matrix may be SPARSE: nothing here requires every combination to exist, only that no combination exists twice.
 */
export function findCreateRowProblems(
  productId: string,
  axisKeys: readonly string[],
  rows: readonly CreateRowInput[],
  existing: { skus: ReadonlySet<string>; variantKeys: ReadonlySet<string> }
): RowProblem[] {
  const problems: RowProblem[] = [];
  const axes = new Set(axisKeys);
  const seenSkus = new Map<string, number>();
  const seenKeys = new Map<string, number>();

  rows.forEach((row, index) => {
    const values = new Set(row.optionValues.map((option) => option.key));
    const missing = axisKeys.filter((key) => !values.has(key));
    const extra = [...values].filter((key) => !axes.has(key));
    const repeated = row.optionValues.length !== values.size;
    const blankValue = row.optionValues.some((option) => !option.value.trim());

    if (missing.length > 0 || extra.length > 0 || repeated || blankValue) {
      const parts = [
        missing.length > 0 ? `missing ${missing.join(", ")}` : "",
        extra.length > 0 ? `unexpected ${extra.join(", ")}` : "",
        repeated ? "an option appears twice" : "",
        blankValue ? "a value is blank" : "",
      ].filter(Boolean);
      problems.push({ index, field: "optionValues", message: `Option values must match the product's options exactly (${parts.join("; ")}).` });
    } else {
      const key = buildVariantKey(productId, row.optionValues);
      if (existing.variantKeys.has(key)) problems.push({ index, field: "optionValues", message: "A variant with this exact option combination already exists." });
      const first = seenKeys.get(key);
      if (first !== undefined) problems.push({ index, field: "optionValues", message: `This option combination is repeated (see row ${first + 1}).` });
      else seenKeys.set(key, index);
    }

    const sku = row.sku.trim();
    if (!sku) {
      problems.push({ index, field: "sku", message: "SKU is required." });
    } else {
      if (existing.skus.has(sku)) problems.push({ index, field: "sku", message: "Variant SKU already exists." });
      const first = seenSkus.get(sku);
      if (first !== undefined) problems.push({ index, field: "sku", message: `SKU is repeated (see row ${first + 1}).` });
      else seenSkus.set(sku, index);
    }
  });

  return problems;
}
