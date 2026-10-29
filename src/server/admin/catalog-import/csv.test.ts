import { describe, expect, it } from "vitest";
import { CsvSyntaxError, parseCsv } from "./csv";

const cells = (text: string) => parseCsv(text).map((record) => record.cells);

describe("parseCsv", () => {
  it("reads plain rows, with CRLF or LF, with or without a final newline", () => {
    expect(cells("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(cells("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps empty cells, including a trailing one", () => {
    expect(cells("a,,c,\n")).toEqual([["a", "", "c", ""]]);
  });

  it("reads quoted fields: embedded commas, doubled quotes and line breaks", () => {
    expect(cells('"a,b","say ""hi""","line1\nline2"\n')).toEqual([["a,b", 'say "hi"', "line1\nline2"]]);
  });

  it("numbers each record by the line it STARTS on, even after a multi-line field", () => {
    const records = parseCsv('h1,h2\n"x\ny",1\nlast,2\n');
    expect(records.map((record) => record.line)).toEqual([1, 2, 4]);
  });

  it("strips a UTF-8 byte-order mark (Excel writes one)", () => {
    expect(cells("﻿product_slug,sku\nx,y")[0]).toEqual(["product_slug", "sku"]);
  });

  it("skips fully blank lines but not a line of empty cells", () => {
    expect(cells("a,b\n\n   \n,\n")).toEqual([["a", "b"], ["", ""]]);
  });

  it("round-trips Arabic, mixed-direction and emoji content untouched", () => {
    const row = '"زيتون بكر ممتاز","Extra virgin زيت 500ml","🫒, ""طازج"""';
    expect(cells(row)).toEqual([["زيتون بكر ممتاز", "Extra virgin زيت 500ml", '🫒, "طازج"']]);
  });

  it("refuses a quote that is never closed and names the line it opened on", () => {
    expect(() => parseCsv('a,b\n1,"oops\n2,3\n')).toThrow(CsvSyntaxError);
    try {
      parseCsv('a,b\n1,"oops\n2,3\n');
    } catch (error) {
      expect((error as CsvSyntaxError).line).toBe(2);
    }
  });

  it("treats a quote in the middle of an unquoted cell literally", () => {
    expect(cells('5" nail,x')).toEqual([['5" nail', "x"]]);
  });
});
