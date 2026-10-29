import { describe, expect, it } from "vitest";
import { attributesProblem, axesProblem, cleanAxes, newAttribute, newAxis, newAxisValue, suggestKey } from "./product-options";

const axis = (key: string, en = "Size", ar = "") => ({ key, name: { en, ar } });

describe("suggestKey", () => {
  it.each([
    ["Size", "size"],
    ["Sleeve length (cm)", "sleeve-length-cm"],
    ["  Colour / Shade ", "colour-shade"],
    ["Café", "cafe"],
    ["المقاس", ""],
  ])("%s → %s", (name, key) => {
    expect(suggestKey(name)).toBe(key);
  });

  it("caps the key at the DTO's 50 characters", () => {
    expect(suggestKey("a".repeat(80))).toHaveLength(50);
  });
});

describe("axesProblem", () => {
  it("accepts none, and named unique axes (Arabic-only names too)", () => {
    expect(axesProblem([])).toBeUndefined();
    expect(axesProblem([axis("size"), axis("colour", "", "اللون")])).toBeUndefined();
  });

  it.each([
    [[axis("")], "Every option needs a key."],
    [[axis("size"), axis(" Size ")], "Two options share a key."],
    [[axis("x".repeat(51))], "Keep option keys to 50 characters."],
    [[axis("size", "", " ")], "Every option needs a name in at least one language."],
  ])("explains a problem", (axes, message) => {
    expect(axesProblem(axes)).toBe(message);
  });
});

describe("attributesProblem", () => {
  const material = { key: "material", name: { en: "Material", ar: "الخامة" }, values: [{ key: "cotton", value: { en: "Cotton", ar: "قطن" } }] };

  it("accepts a complete attribute", () => {
    expect(attributesProblem([material])).toBeUndefined();
  });

  it("requires values, with unique keys and labels", () => {
    expect(attributesProblem([{ ...material, values: [] }])).toBe("Every attribute needs at least one value.");
    expect(attributesProblem([{ ...material, values: [...material.values, { key: "Cotton", value: { en: "x", ar: "" } }] }])).toBe("Two values share a key.");
    expect(attributesProblem([{ ...material, values: [{ key: "silk", value: { en: "", ar: "" } }] }])).toBe("Every attribute value needs a label in at least one language.");
  });

  it("starts new rows blank, which do not validate until filled", () => {
    expect(axesProblem([newAxis()])).toBe("Every option needs a key.");
    expect(attributesProblem([newAttribute()])).toBe("Every attribute needs a key.");
  });
});

describe("cleanAxes", () => {
  it("trims keys and names", () => {
    expect(cleanAxes([{ key: " size ", name: { en: " Size ", ar: " المقاس " } }])).toEqual([{ key: "size", name: { en: "Size", ar: "المقاس" } }]);
  });

  it("KEEPS an option's values — saving a product must not erase the labels and swatches the storefront shows", () => {
    const axes = [{ key: "colour", name: { en: "Colour", ar: "اللون" }, values: [{ key: " red ", label: { en: " Red ", ar: "أحمر" }, swatch: "#FF0000" }] }];
    expect(cleanAxes(axes)).toEqual([{ key: "colour", name: { en: "Colour", ar: "اللون" }, values: [{ key: "red", label: { en: "Red", ar: "أحمر" }, swatch: "#FF0000" }] }]);
  });

  it("a value with no label in one language reads as its own key there; a blank swatch is dropped", () => {
    const [axis] = cleanAxes([{ key: "size", name: { en: "Size", ar: "" }, values: [{ key: "m", label: { en: "Medium", ar: "" }, swatch: " " }] }]);
    expect(axis?.values).toEqual([{ key: "m", label: { en: "Medium", ar: "m" } }]);
  });
});

describe("axesProblem — values", () => {
  const colour = (values: Array<{ key: string; label?: { en: string; ar: string }; swatch?: string }>) => [{ key: "colour", name: { en: "Colour", ar: "" }, values: values.map((v) => ({ label: { en: "", ar: "" }, ...v })) }];

  it("accepts an option with unique values, and one with none", () => {
    expect(axesProblem(colour([{ key: "red" }, { key: "blue", swatch: "#0000ff" }]))).toBeUndefined();
    expect(axesProblem(colour([]))).toBeUndefined();
  });

  it.each([
    [[{ key: "red" }, { key: " Red " }], "Colour: Two values share a key."],
    [[{ key: "" }], "Colour: Every value needs a key."],
    [[{ key: "r|d" }], "Colour: a value key may not contain | = or ;."],
    [[{ key: "red", swatch: "red" }], "Colour: a swatch must be a #RRGGBB colour."],
  ])("explains a bad value", (values, message) => {
    expect(axesProblem(colour(values))).toBe(message);
  });

  it("starts a new value blank, which does not validate until keyed", () => {
    expect(axesProblem([{ ...newAxis(), key: "colour", name: { en: "Colour", ar: "" }, values: [newAxisValue()] }])).toBe("Colour: Every value needs a key.");
  });
});
