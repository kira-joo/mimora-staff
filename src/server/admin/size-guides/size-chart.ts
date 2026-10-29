/**
 * Server-side shape of `SizeGuide.chartData`. The schema stores it as `Mixed`
 * (free-form JSON), so without this a guide could hold anything — a megabyte of
 * junk, or a table the storefront cannot render and silently hides. Validated at
 * the write, so a stored chart is always one the storefront can show.
 *
 * Shape, as the console writes and the storefront reads (`sizeTable`):
 *
 *     { headers: Cell[], rows: Cell[][] }
 *
 * where a `Cell` is a string, a finite number, or a localized label
 * `{ ar: string, en: string }`. Every row is exactly as wide as `headers`, the
 * first column of every row (the size) is non-blank, and every header is
 * non-blank. No other keys. Bounded so a single guide cannot become a payload.
 */
export const SIZE_CHART_LIMITS = {
  maxColumns: 12,
  maxRows: 100,
  maxCellLength: 100,
  /** Serialised size of the whole chart. */
  maxBytes: 20_000,
} as const;

const KEYS = ["headers", "rows"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A localized cell is exactly `{ ar, en }`, both strings. */
const isLocalizedCell = (value: unknown): value is { ar: string; en: string } =>
  isRecord(value) && Object.keys(value).sort().join() === "ar,en" && typeof value.ar === "string" && typeof value.en === "string";

function cellTexts(cell: unknown): string[] | undefined {
  if (typeof cell === "string") return [cell];
  if (typeof cell === "number") return Number.isFinite(cell) ? [String(cell)] : undefined;
  if (isLocalizedCell(cell)) return [cell.ar, cell.en];
  return undefined;
}

/** A cell with no visible text in any locale. */
const isBlank = (texts: string[]) => texts.every((text) => text.trim() === "");

/** Every reason `chartData` is not a valid size chart, or `[]`. Pure. */
export function sizeChartProblems(chartData: unknown): string[] {
  if (!isRecord(chartData)) return ["The size chart must be an object with headers and rows."];

  const problems: string[] = [];
  const extra = Object.keys(chartData).filter((key) => !KEYS.includes(key));
  if (extra.length > 0) problems.push(`The size chart has unexpected keys: ${extra.join(", ")}.`);

  const { headers, rows } = chartData;
  if (!Array.isArray(headers) || headers.length === 0) problems.push("The size chart needs a header row.");
  if (!Array.isArray(rows) || rows.length === 0) problems.push("The size chart needs at least one row.");
  if (!Array.isArray(headers) || !Array.isArray(rows) || headers.length === 0 || rows.length === 0) return problems;

  if (headers.length > SIZE_CHART_LIMITS.maxColumns) problems.push(`The size chart has too many columns (at most ${SIZE_CHART_LIMITS.maxColumns}).`);
  if (rows.length > SIZE_CHART_LIMITS.maxRows) problems.push(`The size chart has too many rows (at most ${SIZE_CHART_LIMITS.maxRows}).`);
  if (JSON.stringify(chartData).length > SIZE_CHART_LIMITS.maxBytes) problems.push("The size chart is too large.");

  const checkCell = (cell: unknown, where: string, options: { required: boolean }) => {
    const texts = cellTexts(cell);
    if (!texts) return problems.push(`${where} must be text, a number, or a { ar, en } label.`);
    if (texts.some((text) => text.length > SIZE_CHART_LIMITS.maxCellLength)) problems.push(`${where} is longer than ${SIZE_CHART_LIMITS.maxCellLength} characters.`);
    if (options.required && isBlank(texts)) problems.push(`${where} must not be blank.`);
  };

  headers.forEach((header, column) => checkCell(header, `Heading ${column + 1}`, { required: true }));

  rows.forEach((row, index) => {
    if (!Array.isArray(row)) return problems.push(`Row ${index + 1} must be a list of cells.`);
    if (row.length !== headers.length) return problems.push(`Row ${index + 1} has ${row.length} cells but there are ${headers.length} headings.`);
    row.forEach((cell, column) => checkCell(cell, `Row ${index + 1}, column ${column + 1}`, { required: column === 0 }));
  });

  return problems;
}
