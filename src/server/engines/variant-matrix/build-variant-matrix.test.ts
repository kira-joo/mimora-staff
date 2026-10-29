import { toMoney } from "@kira-joo/toolkit-common";
import { describe, expect, it } from "vitest";
import { buildVariantMatrix, resolveExactVariant, resolveSelectableValues } from "./build-variant-matrix";
import type { MatrixVariant } from "./variant-matrix.types";

const price = toMoney("50.00");

function variant(overrides: Partial<MatrixVariant> & { optionValues: MatrixVariant["optionValues"] }): MatrixVariant {
  return {
    variantId: overrides.optionValues.map((o) => `${o.key}:${o.value}`).join("|"),
    price,
    purchasable: true,
    lowStock: false,
    ...overrides,
  };
}

describe("the sparse matrix", () => {
  /*
   * size × colour, where S/M exist in red but only S exists in blue — M/blue
   * is a genuinely absent combination, not a purchasable=false one. This is
   * the exact shape the Phase 3 spec calls out: "size M exists" and "blue
   * exists" must not imply "M in blue exists".
   */
  const variants: MatrixVariant[] = [
    variant({ optionValues: [{ key: "size", value: "S" }, { key: "colour", value: "red" }] }),
    variant({ optionValues: [{ key: "size", value: "M" }, { key: "colour", value: "red" }] }),
    variant({ optionValues: [{ key: "size", value: "S" }, { key: "colour", value: "blue" }] }),
    // No size=M, colour=blue variant exists at all.
  ];

  it("excludes a size that has no variant matching the current colour selection", () => {
    const selectable = resolveSelectableValues("size", { colour: "blue" }, variants);
    expect(selectable).toEqual(new Set(["S"]));
    expect(selectable.has("M")).toBe(false);
  });

  it("the independent-per-axis shortcut would produce a false positive here", () => {
    /*
     * Pinned as a regression guard, not just documented: compute each axis's
     * available values with NO regard for the other axis (the shortcut this
     * engine deliberately does not take), then intersect as a naive
     * implementation would. It wrongly concludes M+blue is selectable.
     */
    const independentSizes = new Set(variants.filter((v) => v.purchasable).map((v) => v.optionValues.find((o) => o.key === "size")!.value));
    const independentColours = new Set(variants.filter((v) => v.purchasable).map((v) => v.optionValues.find((o) => o.key === "colour")!.value));

    const naiveShortcutSaysMBlueIsSelectable = independentSizes.has("M") && independentColours.has("blue");
    expect(naiveShortcutSaysMBlueIsSelectable).toBe(true); // the false positive

    const actuallyExists = resolveExactVariant({ size: "M", colour: "blue" }, variants) !== undefined;
    expect(actuallyExists).toBe(false); // the truth this engine gets right

    expect(naiveShortcutSaysMBlueIsSelectable).not.toBe(actuallyExists);
  });

  it("returns every colour when no selection has been made yet", () => {
    expect(resolveSelectableValues("colour", {}, variants)).toEqual(new Set(["red", "blue"]));
  });

  it("resolves the exact variant for a complete selection", () => {
    const found = resolveExactVariant({ size: "S", colour: "blue" }, variants);
    expect(found?.optionValues).toEqual([{ key: "size", value: "S" }, { key: "colour", value: "blue" }]);
  });

  it("returns undefined for a complete selection that does not exist", () => {
    expect(resolveExactVariant({ size: "M", colour: "blue" }, variants)).toBeUndefined();
  });

  it("returns undefined for a partial selection, distinct from a nonexistent one", () => {
    expect(resolveExactVariant({ size: "M" }, variants)).toBeUndefined();
  });
});

describe("a combination that exists but is out of stock", () => {
  /*
   * A combination that does not exist and one that exists with zero stock are
   * different states and must never be conflated — conflating them produces
   * either phantom inventory or unsellable products (Phase 2 §8.2).
   */
  const variants: MatrixVariant[] = [
    variant({ optionValues: [{ key: "size", value: "S" }], purchasable: true }),
    variant({ optionValues: [{ key: "size", value: "M" }], purchasable: false }),
  ];

  it("excludes an unpurchasable variant's value from what remains selectable", () => {
    expect(resolveSelectableValues("size", {}, variants)).toEqual(new Set(["S"]));
  });

  it("does not resolve an exact variant that exists but is unpurchasable", () => {
    expect(resolveExactVariant({ size: "M" }, variants)).toBeUndefined();
  });
});

describe("buildVariantMatrix", () => {
  it("passes through a matrix within the axis cap", () => {
    const variants: MatrixVariant[] = [variant({ optionValues: [{ key: "size", value: "S" }] })];
    expect(buildVariantMatrix(variants)).toBe(variants);
  });

  it("refuses a product with more than the maximum number of axes", () => {
    const variants: MatrixVariant[] = [
      variant({
        optionValues: [
          { key: "size", value: "S" },
          { key: "colour", value: "red" },
          { key: "material", value: "cotton" },
          { key: "fit", value: "slim" },
        ],
      }),
    ];

    expect(() => buildVariantMatrix(variants)).toThrow(/maximum a variant selector supports/);
  });

  it("allows exactly the maximum", () => {
    const variants: MatrixVariant[] = [
      variant({
        optionValues: [
          { key: "size", value: "S" },
          { key: "colour", value: "red" },
          { key: "material", value: "cotton" },
        ],
      }),
    ];

    expect(() => buildVariantMatrix(variants)).not.toThrow();
  });
});
