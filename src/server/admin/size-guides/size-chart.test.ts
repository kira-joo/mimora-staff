import { describe, expect, it } from "vitest";
import { SIZE_CHART_LIMITS, sizeChartProblems } from "./size-chart";

const valid = { headers: ["Size", "Chest"], rows: [["S", "34-36"], ["M", "38-40"]] };

describe("sizeChartProblems", () => {
  it("accepts the shape the console writes", () => {
    expect(sizeChartProblems(valid)).toEqual([]);
  });

  it("accepts numbers and localized { ar, en } labels as cells and headings", () => {
    expect(
      sizeChartProblems({
        headers: [{ ar: "المقاس", en: "Size" }, { ar: "الصدر", en: "Chest" }],
        rows: [[{ ar: "صغير", en: "Small" }, 36], ["M", { ar: "٣٨", en: "38" }]],
      })
    ).toEqual([]);
  });

  it.each([null, undefined, "chart", 5, [], [["S"]]])("rejects a non-object chart (%j)", (value) => {
    expect(sizeChartProblems(value)).not.toEqual([]);
  });

  it("requires a header row and at least one row", () => {
    expect(sizeChartProblems({ headers: [], rows: [["S"]] })).toContain("The size chart needs a header row.");
    expect(sizeChartProblems({ headers: ["Size"], rows: [] })).toContain("The size chart needs at least one row.");
    expect(sizeChartProblems({ rows: [["S"]] })).toContain("The size chart needs a header row.");
    expect(sizeChartProblems({ headers: "Size", rows: "S" })).not.toEqual([]);
  });

  it("rejects a ragged row, naming it", () => {
    expect(sizeChartProblems({ headers: ["Size", "Chest"], rows: [["S", "34"], ["M"]] })).toEqual(["Row 2 has 1 cells but there are 2 headings."]);
  });

  it("rejects a blank heading and a blank size cell, but allows a blank measurement", () => {
    expect(sizeChartProblems({ headers: ["Size", "  "], rows: [["S", "34"]] })).toEqual(["Heading 2 must not be blank."]);
    expect(sizeChartProblems({ headers: ["Size", "Chest"], rows: [["", "34"]] })).toEqual(["Row 1, column 1 must not be blank."]);
    expect(sizeChartProblems({ headers: ["Size", "Chest"], rows: [["S", ""]] })).toEqual([]);
  });

  it("rejects a localized label blank in both languages", () => {
    expect(sizeChartProblems({ headers: [{ ar: "", en: " " }, "Chest"], rows: [["S", "1"]] })).toEqual(["Heading 1 must not be blank."]);
  });

  it.each([
    ["an object that is not a label", { x: 1 }],
    ["a label with a missing locale", { ar: "ع" }],
    ["a label with an extra key", { ar: "ع", en: "e", fr: "f" }],
    ["null", null],
    ["a boolean", true],
    ["a non-finite number", Number.NaN],
    ["an array", ["S"]],
  ])("rejects a cell that is %s", (_, cell) => {
    expect(sizeChartProblems({ headers: ["Size", "Chest"], rows: [["S", cell]] })).not.toEqual([]);
  });

  it("rejects unexpected keys, so nothing else is stored in the chart", () => {
    expect(sizeChartProblems({ ...valid, script: "x" })).toEqual(["The size chart has unexpected keys: script."]);
  });

  it("is bounded: columns, rows, cell length and total size", () => {
    const wide = Array.from({ length: SIZE_CHART_LIMITS.maxColumns + 1 }, (_, i) => `c${i}`);
    expect(sizeChartProblems({ headers: wide, rows: [wide] }).join()).toMatch(/too many columns/);

    const tall = Array.from({ length: SIZE_CHART_LIMITS.maxRows + 1 }, (_, i) => [`s${i}`, "1"]);
    expect(sizeChartProblems({ headers: ["Size", "Chest"], rows: tall }).join()).toMatch(/too many rows/);

    expect(sizeChartProblems({ headers: ["Size", "Chest"], rows: [["S", "x".repeat(SIZE_CHART_LIMITS.maxCellLength + 1)]] }).join()).toMatch(/longer than/);

    const big = Array.from({ length: SIZE_CHART_LIMITS.maxRows }, (_, i) => [`s${i}`, ...Array.from({ length: 11 }, () => "x".repeat(SIZE_CHART_LIMITS.maxCellLength))]);
    expect(sizeChartProblems({ headers: Array.from({ length: 12 }, (_, i) => `c${i}`), rows: big }).join()).toMatch(/too large/);
  });

  it("accepts a chart exactly at the limits", () => {
    const headers = Array.from({ length: SIZE_CHART_LIMITS.maxColumns }, (_, i) => `c${i}`);
    const rows = Array.from({ length: 10 }, (_, r) => headers.map((_, c) => (c === 0 ? `s${r}` : "1")));
    expect(sizeChartProblems({ headers, rows })).toEqual([]);
  });
});
