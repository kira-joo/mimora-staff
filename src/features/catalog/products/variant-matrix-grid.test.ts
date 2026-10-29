import { describe, expect, it } from "vitest";
import type { OptionAxis } from "src/api/products.endpoints";
import {
  MAX_BULK_ROWS,
  blankCreateDraft,
  changesFor,
  combinationId,
  coverage,
  createProblems,
  defaultSkuPattern,
  draftFromVariant,
  existingProblems,
  fillSelected,
  generateCombinations,
  indexByCombination,
  matrixAxes,
  problemsByRow,
  skuToken,
  suggestSku,
  toCreateRow,
} from "./variant-matrix-grid";

const colour: OptionAxis = { key: "colour", name: { en: "Colour", ar: "اللون" }, values: [{ key: "red", label: { en: "Red", ar: "أحمر" } }, { key: "blue", label: { en: "Blue", ar: "أزرق" } }] };
const size: OptionAxis = { key: "size", name: { en: "Size", ar: "المقاس" }, values: [{ key: "s", label: { en: "Small", ar: "صغير" } }, { key: "m", label: { en: "Medium", ar: "وسط" } }] };
const variant = (id: string, ov: Array<[string, string]>, extra: Record<string, unknown> = {}) => ({ _id: id, productId: "p", sku: id, optionValues: ov.map(([key, value]) => ({ key, value })), price: "100.00", stock: 3, unitOfMeasure: "EACH", unitsPerSale: 1, backorderPolicy: "DENY" as const, discontinued: false, ...extra });

describe("matrixAxes and generateCombinations", () => {
  it("lays out every combination of the options' values, in the options' order, with readable labels", () => {
    const combos = generateCombinations(matrixAxes([colour, size], []));
    expect(combos.map((c) => c.label)).toEqual(["Red · Small", "Red · Medium", "Blue · Small", "Blue · Medium"]);
    expect(combos[0]?.optionValues).toEqual([{ key: "colour", value: "red" }, { key: "size", value: "s" }]);
  });

  it("includes a value an existing variant uses that the option does not list — an old variant always has its row", () => {
    const axes = matrixAxes([{ ...colour, values: [] }, size], [variant("v", [["colour", "olive"], ["size", "m"]])]);
    expect(axes[0]?.values).toEqual([{ key: "olive", label: "olive" }]);
    expect(generateCombinations(axes).map((c) => c.label)).toEqual(["olive · Small", "olive · Medium"]);
  });

  it("implies nothing for no options, or for an option that has no values yet", () => {
    expect(generateCombinations([])).toEqual([]);
    expect(generateCombinations(matrixAxes([colour, { ...size, values: undefined }], []))).toEqual([]);
  });

  it("a three-option product multiplies out, and the id is the server's canonical ordering", () => {
    const material: OptionAxis = { key: "material", name: { en: "Material", ar: "" }, values: [{ key: "wool", label: { en: "Wool", ar: "" } }, { key: "cotton", label: { en: "Cotton", ar: "" } }] };
    const combos = generateCombinations(matrixAxes([colour, size, material], []));
    expect(combos).toHaveLength(8);
    // Sorted by option key regardless of the options' order: colour, material, size.
    expect(combos[0]?.id).toBe("|colour=red|material=wool|size=s");
  });
});

describe("sparse matrices — existing vs missing", () => {
  const existing = [variant("v1", [["colour", "red"], ["size", "s"]]), variant("v2", [["size", "m"], ["colour", "blue"]])];
  const combos = generateCombinations(matrixAxes([colour, size], existing));
  const index = indexByCombination(existing);

  it("matches a variant to its combination whatever order its option values are stored in", () => {
    expect(index.get(combos.find((c) => c.label === "Blue · Medium")!.id)?._id).toBe("v2");
  });

  it("marks exactly the combinations that exist — 'size M exists' and 'blue exists' do not imply 'blue in M' for another row", () => {
    expect(coverage(combos, index)).toEqual({ total: 4, existing: 2, missing: 2 });
    expect(index.has(combinationId([{ key: "colour", value: "red" }, { key: "size", value: "m" }]))).toBe(false);
  });
});

describe("SKU suggestions", () => {
  const axes = matrixAxes([colour, size], []);
  const combo = generateCombinations(axes)[0]!;

  it("builds the default pattern from the slug and every option", () => {
    expect(defaultSkuPattern("linen-tee", axes)).toBe("LINEN-TEE-{colour}-{size}");
    expect(defaultSkuPattern("زيت", axes)).toBe("{colour}-{size}");
    expect(defaultSkuPattern("x".repeat(40), [])).toHaveLength(16);
  });

  it("fills the tokens from the values, upper-cased", () => {
    expect(suggestSku("TEE-{colour}-{size}", combo, axes, new Set())).toBe("TEE-RED-S");
  });

  it("never suggests a SKU that is taken — it adds -2, -3", () => {
    const taken = new Set(["TEE-RED-S", "TEE-RED-S-2"]);
    expect(suggestSku("TEE-{colour}-{size}", combo, axes, taken)).toBe("TEE-RED-S-3");
  });

  it("an Arabic value, which has no Latin letters, reads as V and its position", () => {
    expect(skuToken({ key: "أخضر" }, 2)).toBe("V3");
    expect(skuToken({ key: "off-white" }, 0)).toBe("OFF-WHITE");
  });

  it("ignores a token that is not an option, and falls back when everything is empty", () => {
    expect(suggestSku("{nope}", combo, axes, new Set())).toBe("SKU");
    expect(suggestSku("TEE-{nope}-{size}", combo, axes, new Set())).toBe("TEE-S");
  });
});

describe("inline edits to existing variants", () => {
  const v = variant("v1", [["colour", "red"]], { price: "100.00", compareAtPrice: "120.00", costPrice: "40.00" });

  it("reports nothing for an untouched row", () => {
    expect(changesFor(v, draftFromVariant(v))).toBeNull();
  });

  it("reports only the cells that changed", () => {
    expect(changesFor(v, { ...draftFromVariant(v), price: "95" })).toEqual({ id: "v1", price: "95" });
    expect(changesFor(v, { ...draftFromVariant(v), active: false })).toEqual({ id: "v1", discontinued: true });
  });

  it("a blanked compare-at or cost clears it (null), and restoring a discontinued variant sends false", () => {
    expect(changesFor(v, { ...draftFromVariant(v), compareAtPrice: " ", costPrice: "" })).toEqual({ id: "v1", compareAtPrice: null, costPrice: null });
    const off = variant("v2", [], { discontinued: true });
    expect(changesFor(off, { ...draftFromVariant(off), active: true })).toEqual({ id: "v2", discontinued: false });
  });

  it("money stays text and is validated as text: no float parsing", () => {
    expect(existingProblems({ price: "19.90", compareAtPrice: "", costPrice: "0.10", active: true })).toEqual({});
    expect(existingProblems({ price: "1,5", compareAtPrice: "abc", costPrice: "-1", active: true })).toEqual({ price: expect.any(String), compareAtPrice: expect.any(String), costPrice: expect.any(String) });
    expect(existingProblems({ price: " ", compareAtPrice: "", costPrice: "", active: true }).price).toBe("Price is required.");
  });
});

describe("bulk create rows", () => {
  const combo = generateCombinations(matrixAxes([colour, size], []))[1]!;

  it("validates sku, price, optional money and whole-number stock", () => {
    expect(createProblems({ ...blankCreateDraft(), sku: "A-1", price: "10" })).toEqual({});
    expect(createProblems(blankCreateDraft())).toMatchObject({ sku: "SKU is required.", price: "Price is required." });
    expect(createProblems({ ...blankCreateDraft(), sku: "A", price: "10", stock: "1.5" }).stock).toBeDefined();
    expect(createProblems({ ...blankCreateDraft(), sku: "x".repeat(101), price: "10" }).sku).toMatch(/100/);
  });

  it("builds the row the server takes: trimmed, optional money left out, stock a number", () => {
    expect(toCreateRow(combo, { selected: true, sku: " A-1 ", price: " 10.50 ", compareAtPrice: "", costPrice: "4", stock: "7" })).toEqual({
      sku: "A-1",
      optionValues: [{ key: "colour", value: "red" }, { key: "size", value: "m" }],
      price: "10.50",
      costPrice: "4",
      stock: 7,
    });
  });

  it("fills price and stock into the SELECTED rows only, and never overwrites with a blank", () => {
    const drafts = { a: { ...blankCreateDraft(), selected: true, price: "5" }, b: blankCreateDraft() };
    const filled = fillSelected(drafts, { price: "20", stock: "9", costPrice: "" });
    expect(filled.a).toMatchObject({ price: "20", stock: "9", costPrice: "" });
    expect(filled.b).toEqual(blankCreateDraft());
    expect(fillSelected(drafts, { price: " " }).a?.price).toBe("5");
  });

  it("mirrors the server's row cap", () => expect(MAX_BULK_ROWS).toBe(100));
});

describe("problemsByRow", () => {
  it("maps the server's rows.N.field errors back to the combination each row was built from", () => {
    const result = problemsByRow([{ field: "rows.1.sku", message: "SKU is repeated" }, { field: "rows.1.optionValues", message: "exists" }, { field: "rows.0.id", message: "gone" }, { field: "price", message: "ignored" }, { field: "rows.9.sku", message: "out of range" }], ["a", "b"]);
    expect(result.get("b")).toEqual({ sku: "SKU is repeated", optionValues: "exists" });
    expect(result.get("a")).toEqual({ id: "gone" });
    expect(result.size).toBe(2);
    expect(problemsByRow(undefined, ["a"]).size).toBe(0);
  });
});
