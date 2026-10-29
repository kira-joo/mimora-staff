import { describe, expect, it } from "vitest";
import { findCreateRowProblems } from "./variant-row-problems";
import { buildVariantKey } from "./variant-key";

const P = "64b000000000000000000001";
const AXES = ["colour", "size"];
const row = (sku: string, colour = "red", size = "m") => ({ sku, optionValues: [{ key: "colour", value: colour }, { key: "size", value: size }] });
const none = { skus: new Set<string>(), variantKeys: new Set<string>() };

describe("findCreateRowProblems", () => {
  it("accepts a sparse set — only some combinations, in any order", () => {
    expect(findCreateRowProblems(P, AXES, [row("A", "red", "s"), row("B", "blue", "m")], none)).toEqual([]);
  });

  it("accepts an empty batch and a product with no axes (one variant)", () => {
    expect(findCreateRowProblems(P, AXES, [], none)).toEqual([]);
    expect(findCreateRowProblems(P, [], [{ sku: "ONLY", optionValues: [] }], none)).toEqual([]);
  });

  it("reports a missing, an unexpected, a repeated and a blank option value", () => {
    const rows = [
      { sku: "A", optionValues: [{ key: "colour", value: "red" }] },
      { sku: "B", optionValues: [{ key: "colour", value: "red" }, { key: "size", value: "m" }, { key: "fit", value: "slim" }] },
      { sku: "C", optionValues: [{ key: "colour", value: "red" }, { key: "colour", value: "blue" }, { key: "size", value: "m" }] },
      row("D", " ", "m"),
    ];
    const problems = findCreateRowProblems(P, AXES, rows, none);
    expect(problems.map((p) => [p.index, p.field])).toEqual([[0, "optionValues"], [1, "optionValues"], [2, "optionValues"], [3, "optionValues"]]);
    expect(problems[0]?.message).toMatch(/missing size/);
    expect(problems[1]?.message).toMatch(/unexpected fit/);
    expect(problems[2]?.message).toMatch(/appears twice/);
    expect(problems[3]?.message).toMatch(/blank/);
  });

  it("reports a SKU that already exists, and a combination that already exists", () => {
    const existing = { skus: new Set(["TAKEN"]), variantKeys: new Set([buildVariantKey(P, row("x").optionValues)]) };
    const problems = findCreateRowProblems(P, AXES, [row("TAKEN", "blue", "s"), row("FRESH", "red", "m")], existing);
    expect(problems).toEqual([
      { index: 0, field: "sku", message: "Variant SKU already exists." },
      { index: 1, field: "optionValues", message: "A variant with this exact option combination already exists." },
    ]);
  });

  it("finds collisions between rows of the batch itself, naming the first row", () => {
    const problems = findCreateRowProblems(P, AXES, [row("A", "red", "s"), row("A", "blue", "s"), row("C", "red", "s")], none);
    expect(problems).toEqual([
      { index: 1, field: "sku", message: "SKU is repeated (see row 1)." },
      { index: 2, field: "optionValues", message: "This option combination is repeated (see row 1)." },
    ]);
  });

  it("treats the same combination listed in a different key order as the same variant", () => {
    const swapped = { sku: "B", optionValues: [{ key: "size", value: "s" }, { key: "colour", value: "red" }] };
    expect(findCreateRowProblems(P, AXES, [row("A", "red", "s"), swapped], none)).toHaveLength(1);
  });

  it("requires a SKU, and trims it before comparing", () => {
    expect(findCreateRowProblems(P, AXES, [row("  ")], none)).toEqual([{ index: 0, field: "sku", message: "SKU is required." }]);
    expect(findCreateRowProblems(P, AXES, [row(" A ", "red", "s"), row("A", "blue", "s")], none)).toHaveLength(1);
  });

  it("reports every problem at once, not just the first", () => {
    const problems = findCreateRowProblems(P, AXES, [row(""), row(""), { sku: "Z", optionValues: [] }], none);
    expect(problems.length).toBeGreaterThanOrEqual(4);
  });
});
