/**
 * A small RFC 4180 reader: comma-delimited, double-quoted fields, `""` for a quote inside one, line breaks
 * (CRLF or LF) allowed inside quotes, a leading UTF-8 byte-order mark ignored. Fully blank lines are skipped.
 *
 * Kept in the application rather than in a package: it has one consumer (the catalog import). The day a second
 * repository needs to read a CSV it belongs in `@kira-joo/toolkit-common` — see the toolkit-first rule's own
 * warning against promoting on hypothetical reuse.
 *
 * Each record carries the physical line it STARTS on (1-based), because a quoted field can span lines and every
 * error the importer reports must point at a line a person can find in the file.
 */
export interface CsvRecord {
  line: number;
  cells: string[];
}

export class CsvSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number
  ) {
    super(message);
    this.name = "CsvSyntaxError";
  }
}

export function parseCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quoteOpenedAtLine = 1;
  let line = 1;
  let recordLine = 1;
  let cellStarted = false;

  const endCell = () => {
    cells.push(cell);
    cell = "";
    cellStarted = false;
  };
  const endRecord = () => {
    endCell();
    if (cells.length > 1 || cells[0]!.trim() !== "") records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"' && !cellStarted && cell === "") {
      inQuotes = true;
      cellStarted = true;
      quoteOpenedAtLine = line;
    } else if (char === ",") {
      endCell();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      cell += char;
      cellStarted = true;
    }
  }

  if (inQuotes) throw new CsvSyntaxError("A quoted field is never closed — check for a stray double quote.", quoteOpenedAtLine);
  if (cell !== "" || cells.length > 0) endRecord();
  return records;
}
