import { describe, expect, it } from "vitest";
import { EMPTY_CHART, addColumn, addRow, chartProblem, cleanChart, readChart, removeColumn, removeRow, setCell, setHeader } from "./size-chart";

describe("readChart", () => {
  it("reads the stored { headers, rows } shape", () => {
    expect(readChart({ headers: ["Size", "Chest"], rows: [["S", "34-36"]] })).toEqual({ headers: ["Size", "Chest"], rows: [["S", "34-36"]] });
  });

  it("pads ragged rows and headers to one width, and stringifies numbers", () => {
    expect(readChart({ headers: ["Size"], rows: [["S", 34, "x"], ["M"]] })).toEqual({
      headers: ["Size", "", ""],
      rows: [
        ["S", "34", "x"],
        ["M", "", ""],
      ],
    });
  });

  it.each([null, undefined, "chart", 5, {}, { headers: "Size", rows: "S" }])("turns unrecognisable data (%j) into a usable chart", (data) => {
    const chart = readChart(data);
    expect(chart.rows.length).toBeGreaterThan(0);
    expect(chart.rows.every((row) => row.length === chart.headers.length)).toBe(true);
  });

  it("returns a copy, never the shared empty chart", () => {
    const chart = readChart(null);
    chart.headers[0] = "changed";
    expect(EMPTY_CHART.headers[0]).toBe("Size");
  });
});

describe("editing", () => {
  const chart = { headers: ["Size", "Chest"], rows: [["S", "34"], ["M", "38"]] };

  it("sets a header and a cell without touching the rest", () => {
    expect(setHeader(chart, 1, "Waist").headers).toEqual(["Size", "Waist"]);
    expect(setCell(chart, 1, 1, "40").rows).toEqual([["S", "34"], ["M", "40"]]);
    expect(chart.rows[1]).toEqual(["M", "38"]);
  });

  it("adds a row as wide as the headers, and a column to every row", () => {
    expect(addRow(chart).rows[2]).toEqual(["", ""]);
    const wider = addColumn(chart);
    expect(wider.headers).toEqual(["Size", "Chest", ""]);
    expect(wider.rows.every((row) => row.length === 3)).toBe(true);
  });

  it("removes rows and columns but keeps the minimum chart", () => {
    expect(removeRow(chart, 0).rows).toEqual([["M", "38"]]);
    expect(removeRow(removeRow(chart, 0), 0).rows).toEqual([["M", "38"]]);
    expect(removeColumn(chart, 1)).toBe(chart);
    expect(removeColumn(addColumn(chart), 2).headers).toEqual(["Size", "Chest"]);
  });
});

describe("cleanChart and chartProblem", () => {
  it("trims cells and drops blank rows", () => {
    expect(cleanChart({ headers: [" Size ", "Chest"], rows: [[" S", "34 "], ["  ", ""]] })).toEqual({ headers: ["Size", "Chest"], rows: [["S", "34"]] });
  });

  it("accepts a complete chart, including Arabic headings", () => {
    expect(chartProblem({ headers: ["المقاس", "الصدر — Chest"], rows: [["S", "34"]] })).toBeUndefined();
  });

  it.each([
    [{ headers: ["Size", ""], rows: [["S", "34"]] }, "Every column needs a heading."],
    [{ headers: ["Size", "size"], rows: [["S", "34"]] }, "Two columns have the same heading."],
    [{ headers: ["Size", "Chest"], rows: [["", ""]] }, "Add at least one size."],
    [{ headers: ["Size", "Chest"], rows: [["", "34"]] }, "Every row needs a size in the first column."],
  ])("explains what is missing", (chart, message) => {
    expect(chartProblem(chart)).toBe(message);
  });
});
