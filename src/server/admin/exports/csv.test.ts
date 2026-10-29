import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvDocument, csvRow, csvStream, numberCell, pageByIdCursor } from "./csv";

describe("csvCell — formula injection", () => {
  it.each(["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\t=1", "\r=1"])("prefixes %j so a spreadsheet reads it as text", (cell) => {
    const out = csvCell(cell);
    expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("leaves ordinary text, Arabic and mid-string symbols alone", () => {
    expect(csvCell("Mona")).toBe("Mona");
    expect(csvCell("منى أحمد")).toBe("منى أحمد");
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("5-3")).toBe("5-3");
  });

  it("a number the exporter formatted is never prefixed — a refund stays a number", () => {
    expect(csvCell(numberCell("-5.00"))).toBe("-5.00");
    expect(csvCell(-5)).toBe("-5");
  });

  it("numberCell refuses anything that is not a plain number (it is the bypass, so it must be strict)", () => {
    expect(() => numberCell("=1+1")).toThrow();
    expect(() => numberCell("1,5")).toThrow();
  });

  it("the prefix and RFC 4180 quoting compose", () => {
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });
});

describe("csvCell — quoting and values", () => {
  it("quotes commas, quotes, CR/LF and edge whitespace", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(" padded")).toBe('" padded"');
  });

  it("renders nullish as empty, booleans as Yes/No and dates as ISO", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("Yes");
    expect(csvCell(false)).toBe("No");
    expect(csvCell(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(csvCell(new Date("nope"))).toBe("");
  });

  it("rows end CRLF and the document starts with the UTF-8 BOM", () => {
    expect(csvRow(["a", "b"])).toBe("a,b\r\n");
    const doc = csvDocument(["h"], [["x"]]);
    expect(doc.startsWith(CSV_BOM)).toBe(true);
    expect(doc).toBe(`${CSV_BOM}h\r\nx\r\n`);
  });
});

async function* rowsOf(count: number) {
  for (let i = 0; i < count; i += 1) yield [`row-${i}`, "منى"] as const;
}
async function readAll(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).arrayBuffer();
}

describe("csvStream", () => {
  it("emits BOM bytes first, then header and every row, and decodes back to the same Arabic", async () => {
    const bytes = new Uint8Array(await readAll(csvStream(["id", "name"], rowsOf(3))));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text).toBe(`${CSV_BOM}id,name\r\nrow-0,منى\r\nrow-1,منى\r\nrow-2,منى\r\n`);
  });

  it("an error in the source errors the stream — a truncated file never looks complete", async () => {
    async function* failing() {
      yield ["a"] as const;
      throw new Error("db went away");
    }
    await expect(readAll(csvStream(["h"], failing()))).rejects.toThrow("db went away");
  });
});

describe("pageByIdCursor", () => {
  it("walks every page once, passing the last id forward, and stops on a short page", async () => {
    const all = Array.from({ length: 25 }, (_, i) => ({ _id: i + 1 }));
    const seen: unknown[] = [];
    const pages = pageByIdCursor(async (after) => {
      seen.push(after);
      return all.filter((row) => row._id > ((after as number | undefined) ?? 0)).slice(0, 10);
    }, 10);
    const rows: number[] = [];
    for await (const page of pages) rows.push(...page.map((row) => row._id));
    expect(rows).toEqual(all.map((row) => row._id));
    expect(seen).toEqual([undefined, 10, 20]);
  });

  it("an exact multiple of the page size costs one extra, empty fetch — and loses nothing", async () => {
    const all = Array.from({ length: 20 }, (_, i) => ({ _id: i + 1 }));
    const rows: number[] = [];
    for await (const page of pageByIdCursor(async (after) => all.filter((row) => row._id > ((after as number | undefined) ?? 0)).slice(0, 10), 10)) rows.push(...page.map((row) => row._id));
    expect(rows).toHaveLength(20);
  });
});
