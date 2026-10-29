import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { MAX_OPTION_AXES, type AxisSelection, type MatrixVariant } from "./variant-matrix.types";

/**
 * Produces the compact, purchasable matrix a product page needs, and asserts
 * the v1 axis cap. This is a thin, validating pass-through — the real
 * correctness lives in `resolveSelectableValues` below, because a matrix is
 * only as useful as what a customer can do with it: pick a partial selection
 * and find out what remains chooseable.
 */
export function buildVariantMatrix(variants: MatrixVariant[]): MatrixVariant[] {
  const axisKeys = new Set(variants.flatMap((variant) => variant.optionValues.map((option) => option.key)));

  if (axisKeys.size > MAX_OPTION_AXES) {
    throw new ConflictError(
      `This product has ${axisKeys.size} option axes; ${MAX_OPTION_AXES} is the maximum a variant selector supports. It needs a configurator instead.`
    );
  }

  return variants;
}

/**
 * Which values remain selectable for one axis, given the customer's current
 * (possibly partial) selection on every other axis.
 *
 * **Availability is an existential query, not a per-axis one.** A value is
 * selectable iff at least one variant exists that is purchasable, carries
 * that value, and matches every other currently-selected axis. "Size M
 * exists" and "red exists" does not imply "M in red exists" — computing each
 * axis's available values independently and treating the two sets as a
 * conjunction produces exactly that false positive on a sparse matrix, which
 * is why this function filters candidates against the FULL selection rather
 * than building independent per-axis sets and intersecting them. See
 * `build-variant-matrix.test.ts` for a case where the shortcut would have
 * disagreed with this.
 */
export function resolveSelectableValues(
  axisKey: string,
  currentSelection: AxisSelection,
  variants: MatrixVariant[]
): Set<string> {
  const otherAxes = Object.entries(currentSelection).filter(([key]) => key !== axisKey);

  const selectable = new Set<string>();

  for (const variant of variants) {
    if (!variant.purchasable) continue;

    const matchesOtherAxes = otherAxes.every(([key, value]) =>
      variant.optionValues.some((option) => option.key === key && option.value === value)
    );
    if (!matchesOtherAxes) continue;

    const ownValue = variant.optionValues.find((option) => option.key === axisKey)?.value;
    if (ownValue !== undefined) selectable.add(ownValue);
  }

  return selectable;
}

/**
 * The single purchasable variant matching a COMPLETE selection, if one
 * exists. A partial selection returns `undefined` — the customer has not
 * chosen an axis value yet, which is a different state from "chose a
 * combination that doesn't exist."
 *
 * Presentation-layer convenience for resolving "add to cart" to a concrete
 * `variantId` client-side. **The server re-validates at add-to-cart and at
 * placement regardless** — this never substitutes for that check.
 */
export function resolveExactVariant(selection: AxisSelection, variants: MatrixVariant[]): MatrixVariant | undefined {
  const selectedEntries = Object.entries(selection);

  return variants.find(
    (variant) =>
      variant.purchasable &&
      selectedEntries.every(([key, value]) =>
        variant.optionValues.some((option) => option.key === key && option.value === value)
      ) &&
      variant.optionValues.length === selectedEntries.length
  );
}
