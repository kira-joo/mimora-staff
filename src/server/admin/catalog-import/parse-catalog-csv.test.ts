import { describe, expect, it } from "vitest";
import { IMPORT_COLUMNS, IMPORT_TEMPLATE_HEADER } from "./import-columns";
import { ImportFileError, parseCatalogCsv } from "./parse-catalog-csv";
import { MAX_IMPORT_VARIANT_ROWS } from "./import-types";

const HEADER = "product_slug,name_en,name_ar,category_slug,status,option_axes,sku,option_values,price,compare_at_price,cost,stock";
const parse = (...lines: string[]) => parseCatalogCsv([HEADER, ...lines].join("\n"));
const messages = (result: ReturnType<typeof parseCatalogCsv>) => result.errors.map((error) => `${error.row}:${error.column ?? "-"}:${error.message}`);

describe("parseCatalogCsv — a valid file", () => {
  it("groups rows by product slug into one product with its variants, tracing each to its line", () => {
    const result = parse(
      "tee,Tee,تي شيرت,tops,published,colour|Colour|اللون;size,TEE-R-S,colour=red;size=s,100,150,40,5",
      "tee,,,,,,TEE-R-M,colour=red;size=m,100,,,0",
      "mug,Mug,كوب,home,,,MUG-1,,35.50,,,12"
    );
    expect(result.errors).toEqual([]);
    expect(result.lines).toBe(3);
    expect(result.products.map((product) => [product.slug, product.line, product.variants.length])).toEqual([["tee", 2, 2], ["mug", 4, 1]]);

    const tee = result.products[0]!;
    expect(tee.name).toEqual({ en: "Tee", ar: "تي شيرت" });
    expect(tee.status).toBe("published");
    expect(tee.optionAxes?.map((axis) => axis.key)).toEqual(["colour", "size"]);
    expect(tee.optionAxes?.[0]?.name).toEqual({ en: "Colour", ar: "اللون" });
    expect(tee.optionAxes?.[0]?.values.map((value) => value.key)).toEqual(["red"]);
    expect(tee.variants[0]).toMatchObject({ line: 2, sku: "TEE-R-S", price: "100", compareAtPrice: "150", costPrice: "40", stock: 5, optionValues: [{ key: "colour", value: "red" }, { key: "size", value: "s" }] });
    expect(tee.variants[1]?.stock).toBe(0);
    expect(result.products[1]?.optionAxes).toBeUndefined();
  });

  it("keeps money as the string it was written — never a float", () => {
    expect(parse("a,A,,c,,,A-1,,19.90,,,").products[0]?.variants[0]?.price).toBe("19.90");
  });

  it("infers a product's options from its option_values when option_axes is left out", () => {
    const result = parse("a,A,,c,,,A-1,colour=red,1,,,", "a,,,,,,A-2,colour=blue,1,,,");
    expect(result.errors).toEqual([]);
    expect(result.products[0]?.optionAxes).toEqual([{ key: "colour", name: {}, values: [{ key: "red", label: {} }, { key: "blue", label: {} }] }]);
  });

  it("reads Arabic names and option values, comma-quoted text, and a byte-order mark", () => {
    const content = `﻿${HEADER}\n"ثوب, قطن",ثوب,,c,,,ث-1,,5,,,\n`;
    const result = parseCatalogCsv(content.replace('"ثوب, قطن"', "thawb"));
    expect(result.products[0]?.name).toEqual({ en: "ثوب" });
    const quoted = parse('arabic,"زيت زيتون, بكر",زيت,c,,,Z-1,,5,,,');
    expect(quoted.products[0]?.name).toEqual({ en: "زيت زيتون, بكر", ar: "زيت" });
  });

  it("reads option labels, attributes and attribute names", () => {
    const content = [
      "product_slug,name_en,category_slug,option_axes,option_value_labels,attributes,attribute_names,sku,option_values,price",
      'a,A,c,colour,"colour.red=Red|أحمر","material=cotton|Cotton|قطن;material=linen|Linen|كتان;fit=slim|Slim","material=Material|الخامة",A-1,colour=red,1',
    ].join("\n");
    const product = parseCatalogCsv(content).products[0]!;
    expect(product.optionAxes?.[0]?.values).toEqual([{ key: "red", label: { en: "Red", ar: "أحمر" } }]);
    expect(product.attributes).toEqual([
      { key: "material", name: { en: "Material", ar: "الخامة" }, values: [{ key: "cotton", value: { en: "Cotton", ar: "قطن" } }, { key: "linen", value: { en: "Linen", ar: "كتان" } }] },
      { key: "fit", name: {}, values: [{ key: "slim", value: { en: "Slim" } }] },
    ]);
  });

  it("accepts header spelling variants and warns about unknown columns", () => {
    const result = parseCatalogCsv("Product Slug,SKU,Price,mystery\nx,X-1,5,?");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{ row: 1, column: "mystery", message: 'Unknown column "mystery" — ignored.' }]);
  });

  it("a re-pricing file may leave option_values out entirely — the existing variants already hold theirs", () => {
    const result = parse("a,,,c,,,A-1,,12,,,", "a,,,c,,,A-2,,13,,,");
    expect(result.errors).toEqual([]);
    expect(result.products[0]?.optionAxes).toBeUndefined();
  });

  it("the template header is exactly the column contract", () => {
    expect(IMPORT_TEMPLATE_HEADER.split(",")).toEqual([...IMPORT_COLUMNS]);
    expect(() => parseCatalogCsv(`${IMPORT_TEMPLATE_HEADER}\nx,,,,,,,,,,,,X-1,,5,,,,,,,,`)).not.toThrow();
  });
});

describe("parseCatalogCsv — row errors are collected, all at once, with their line", () => {
  it("reports every bad cell instead of stopping at the first", () => {
    const result = parse(
      "a,A,,c,,,A-1,,10,,,",
      ",A,,c,,,A-2,,10,,,",
      "b,B,,c,sold-out,,B-1,,ten,,,-3",
      "c,C,,c,,,,,10,,,",
      "d,D,,c,,,D-1,,10,12.345,,"
    );
    const text = messages(result);
    expect(text).toContain("3:product_slug:product_slug is required.");
    expect(text.some((line) => /^4:status:status "sold-out" is not one of/.test(line))).toBe(true);
    expect(text.some((line) => /^4:price:price "ten" is not an amount/.test(line))).toBe(true);
    expect(text.some((line) => /^4:stock:stock "-3" is not valid/.test(line))).toBe(true);
    expect(text).toContain("5:sku:sku is required.");
    expect(text.some((line) => /^6:compare_at_price:compare_at_price "12.345" is not an amount/.test(line))).toBe(true);
    const rows = result.errors.map((error) => error.row);
    expect(new Set(rows)).toEqual(new Set([3, 4, 5, 6]));
  });

  it.each([
    ["a price with a currency symbol", "EGP 100"],
    ["a thousands separator", "1,000"],
    ["a negative price", "-5"],
    ["an Arabic-Indic digit", "١٠٠"],
    ["three decimals", "1.999"],
  ])("refuses %s", (_label, price) => {
    const result = parse(`a,A,,c,,,A-1,,"${price}",,,`);
    expect(result.errors.some((error) => error.column === "price")).toBe(true);
  });

  it("flags a SKU repeated in the file and names the first line", () => {
    const result = parse("a,A,,c,,,DUP,,1,,,", "b,B,,c,,,DUP,,1,,,");
    expect(messages(result)).toEqual(['3:sku:sku "DUP" is repeated (first on line 2).']);
  });

  it("flags rows of one product that disagree about the product", () => {
    const result = parse("a,Tee,,c,,colour,A-1,colour=red,1,,,", "a,Shirt,,c,,,A-2,colour=blue,1,,,");
    expect(messages(result)).toEqual([expect.stringMatching(/^3:name_en:name_en differs from line 2/)]);
  });

  it("flags option values that do not match the product's options, and a repeated combination", () => {
    const result = parse(
      "a,A,,c,,colour;size,A-1,colour=red,1,,,",
      "a,,,,,,A-2,colour=red;size=s;fit=slim,1,,,",
      "a,,,,,,A-3,colour=red;size=s,1,,,",
      "a,,,,,,A-4,size=s;colour=red,1,,,"
    );
    expect(messages(result)).toEqual([
      expect.stringMatching(/^2:option_values:.*missing size/),
      expect.stringMatching(/^3:option_values:.*not an option of this product: fit/),
      expect.stringMatching(/^5:option_values:This option combination is already on line 4/),
    ]);
  });

  it("refuses an option value that would break the variant key", () => {
    expect(parse("a,A,,c,,,A-1,colour=r|d,1,,,").errors.some((error) => error.column === "option_values")).toBe(true);
    expect(parse("a,A,,c,,,A-1,colour,1,,,").errors.some((error) => error.column === "option_values")).toBe(true);
  });

  it("explains a row with more cells than the header — an unquoted comma", () => {
    expect(messages(parse("a,Olive, extra virgin,c,,,A-1,,1,,,,"))[0]).toMatch(/comma inside a value needs the value in double quotes/);
  });
});

describe("parseCatalogCsv — a file that cannot be read at all", () => {
  it.each([
    ["an empty file", "", /empty/],
    ["a header and nothing else", `${HEADER}\n`, /no rows/],
    ["a missing required column", "product_slug,name_en\nx,y", /Required column.*sku, price/],
    ["a semicolon-delimited file", "product_slug;sku;price\nx;y;1", /semicolon/],
    ["an unclosed quote", `${HEADER}\n"a,b`, /Line 2.*never closed/],
  ])("%s throws ImportFileError", (_label, content, message) => {
    expect(() => parseCatalogCsv(content)).toThrow(ImportFileError);
    expect(() => parseCatalogCsv(content)).toThrow(message);
  });

  it("refuses more rows than one import takes", () => {
    const rows = Array.from({ length: MAX_IMPORT_VARIANT_ROWS + 1 }, (_, i) => `p${i},P,,c,,,S${i},,1,,,`);
    expect(() => parse(...rows)).toThrow(/at most 500/);
  });
});
