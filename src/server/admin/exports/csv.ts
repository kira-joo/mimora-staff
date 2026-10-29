/**
 * CSV for spreadsheets — the pure part. Three guarantees, each a real failure
 * somewhere else:
 *
 *  1. **Formula injection.** A cell that starts with `=`, `+`, `-`, `@`, a tab or a
 *     carriage return is run as a formula by Excel/Sheets — and the text here is
 *     customer-typed (names, notes, addresses). Such a text cell is prefixed with a
 *     single quote, which spreadsheets show as nothing and treat as "this is text".
 *     Numbers the exporter formats itself go through `numberCell`, which is never
 *     prefixed (a refund of `-5.00` must stay a number).
 *  2. **Arabic opens as Arabic.** Excel guesses an encoding for a CSV; without a
 *     byte-order mark it picks the legacy code page and Arabic becomes mojibake. The
 *     file starts with a UTF-8 BOM.
 *  3. **Quoting.** Any cell with a comma, quote, CR or LF is quoted with quotes doubled
 *     (RFC 4180); rows end CRLF.
 */
export const CSV_BOM = "﻿";
export const CSV_EOL = "\r\n";

/** A pre-formatted numeric cell (money at fixed decimals, a count) — written as is, never injection-prefixed. */
export class NumberCell {
  constructor(readonly text: string) {
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`NumberCell needs a plain decimal number, got "${text}".`);
  }
}
export const numberCell = (text: string | number): NumberCell => new NumberCell(String(text));

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export type CsvValue = string | number | boolean | Date | NumberCell | null | undefined;

function quoteIfNeeded(text: string): string {
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof NumberCell) return value.text;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return quoteIfNeeded(FORMULA_TRIGGER.test(value) ? `'${value}` : value);
}

export function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(",") + CSV_EOL;
}

/** A whole CSV as text (BOM, header, rows) — for tests and small, in-memory uses; the routes stream. */
export function csvDocument(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return CSV_BOM + csvRow(header) + rows.map(csvRow).join("");
}

/**
 * Streams a CSV: the BOM and header first, then rows as the source yields them —
 * so memory stays one batch deep however many rows there are, and there is no row
 * cap. An error mid-way errors the stream (the download fails visibly) rather than
 * ending it cleanly and handing over a file that is silently truncated.
 */
export function csvStream(header: readonly string[], rows: AsyncIterable<readonly CsvValue[]>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = rows[Symbol.asyncIterator]();
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(encoder.encode(CSV_BOM + csvRow(header)));
          return;
        }
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(csvRow(next.value)));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** What an export route needs to answer: a name, the header row, and the rows (any async source). */
export interface CsvExport {
  /** Without extension. The date is appended. */
  filename: string;
  header: readonly string[];
  rows: AsyncIterable<readonly CsvValue[]>;
}

/**
 * Keyset-pages an `_id`-ordered source: `fetchPage(afterId)` returns the next page
 * (up to `pageSize` rows) strictly after that id; a short page ends it. Keyset, not
 * skip/limit: rows inserted or removed while the export runs can neither repeat nor
 * skip a row, and the cost per page does not grow with the offset.
 */
export async function* pageByIdCursor<T extends { _id: unknown }>(fetchPage: (afterId: unknown) => Promise<T[]>, pageSize: number): AsyncGenerator<T[]> {
  let after: unknown;
  for (;;) {
    const page = await fetchPage(after);
    if (page.length > 0) yield page;
    if (page.length < pageSize) return;
    after = page[page.length - 1]!._id;
  }
}
