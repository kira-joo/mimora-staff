import type { SizeChart } from "src/api/size-guides.endpoints";

/** A fresh chart: one size column plus one measurement, one row. */
export const EMPTY_CHART: SizeChart = { headers: ["Size", ""], rows: [["", ""]] };

const asText = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

/**
 * Reads stored `chartData` (free-form JSON on the schema) into a rectangular
 * chart: string cells, every row as wide as the headers. Anything
 * unrecognisable becomes an empty chart rather than a crash.
 */
export function readChart(data: unknown): SizeChart {
  if (!data || typeof data !== "object") return structuredClone(EMPTY_CHART);
  const raw = data as { headers?: unknown; rows?: unknown };
  const headers = Array.isArray(raw.headers) ? raw.headers.map(asText) : [];
  const rows = Array.isArray(raw.rows) ? raw.rows.filter(Array.isArray).map((row) => (row as unknown[]).map(asText)) : [];
  const width = Math.max(headers.length, ...rows.map((row) => row.length), 1);
  const pad = (cells: string[]) => [...cells, ...Array<string>(width - cells.length).fill("")];
  return { headers: pad(headers), rows: rows.length ? rows.map(pad) : [pad([])] };
}

export const setHeader = (chart: SizeChart, column: number, value: string): SizeChart => ({
  ...chart,
  headers: chart.headers.map((header, index) => (index === column ? value : header)),
});

export const setCell = (chart: SizeChart, row: number, column: number, value: string): SizeChart => ({
  ...chart,
  rows: chart.rows.map((cells, r) => (r === row ? cells.map((cell, c) => (c === column ? value : cell)) : cells)),
});

export const addRow = (chart: SizeChart): SizeChart => ({ ...chart, rows: [...chart.rows, chart.headers.map(() => "")] });

export const addColumn = (chart: SizeChart): SizeChart => ({ headers: [...chart.headers, ""], rows: chart.rows.map((cells) => [...cells, ""]) });

/** Keeps at least one row: a chart with no sizes is not a chart. */
export const removeRow = (chart: SizeChart, row: number): SizeChart => (chart.rows.length <= 1 ? chart : { ...chart, rows: chart.rows.filter((_, r) => r !== row) });

/** Keeps at least two columns: the size and one measurement. */
export const removeColumn = (chart: SizeChart, column: number): SizeChart =>
  chart.headers.length <= 2
    ? chart
    : { headers: chart.headers.filter((_, c) => c !== column), rows: chart.rows.map((cells) => cells.filter((_, c) => c !== column)) };

/** Trims every cell and drops rows left entirely blank — what gets saved. */
export function cleanChart(chart: SizeChart): SizeChart {
  const headers = chart.headers.map((header) => header.trim());
  const rows = chart.rows.map((cells) => cells.map((cell) => cell.trim())).filter((cells) => cells.some(Boolean));
  return { headers, rows };
}

/** Why the chart can't be saved, or `undefined` when it can. Run on the cleaned chart. */
export function chartProblem(chart: SizeChart): string | undefined {
  const clean = cleanChart(chart);
  if (clean.headers.some((header) => !header)) return "Every column needs a heading.";
  if (new Set(clean.headers.map((header) => header.toLowerCase())).size !== clean.headers.length) return "Two columns have the same heading.";
  if (clean.rows.length === 0) return "Add at least one size.";
  if (clean.rows.some((cells) => !cells[0])) return "Every row needs a size in the first column.";
  return undefined;
}
