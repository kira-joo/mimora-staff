import { describe, expect, it } from "vitest";
import { buildAttributeCatalog } from "./attribute-catalog";

const L = (en: string, ar: string) => ({ en, ar });
const attr = (key: string, name: { en: string; ar: string }, values: Array<[string, { en: string; ar: string }]>) => ({ key, name, values: values.map(([k, value]) => ({ key: k, value })) });

describe("buildAttributeCatalog", () => {
  it("is empty without products or attributes", () => {
    expect(buildAttributeCatalog([])).toEqual([]);
    expect(buildAttributeCatalog([{}, { attributes: [] }, { attributes: null }])).toEqual([]);
  });

  it("groups by key across products and counts each product once", () => {
    const catalog = buildAttributeCatalog([
      { attributes: [attr("material", L("Material", "الخامة"), [["gold", L("Gold", "ذهب")]])] },
      { attributes: [attr("material", L("Material", "الخامة"), [["gold", L("Gold", "ذهب")], ["silver", L("Silver", "فضة")]])] },
      { attributes: [attr("fit", L("Fit", "القصة"), [["slim", L("Slim", "ضيق")]])] },
    ]);
    expect(catalog.map((e) => [e.key, e.productCount])).toEqual([["fit", 1], ["material", 2]]);
    const material = catalog.find((e) => e.key === "material")!;
    expect(material.values.map((v) => [v.key, v.productCount])).toEqual([["gold", 2], ["silver", 1]]);
    expect(material.nameVariants).toEqual([L("Material", "الخامة")]);
  });

  it("a key repeated inside one product (or a repeated value) counts once", () => {
    const [entry] = buildAttributeCatalog([{ attributes: [attr("m", L("M", "م"), [["a", L("A", "أ")], ["a", L("A", "أ")]]), attr("m", L("M", "م"), [])] }]);
    expect(entry!.productCount).toBe(1);
    expect(entry!.values).toEqual([{ key: "a", value: L("A", "أ"), productCount: 1 }]);
  });

  it("picks the most frequent name and lists every variant, most used first", () => {
    const rows = [
      { attributes: [attr("color", L("Color", "اللون"), [["red", L("Red", "أحمر")]])] },
      { attributes: [attr("color", L("Colour", "اللون"), [["red", L("Crimson", "أحمر")]])] },
      { attributes: [attr("color", L("Colour", "اللون"), [["red", L("Red", "أحمر")]])] },
    ];
    const [entry] = buildAttributeCatalog(rows);
    expect(entry!.name).toEqual(L("Colour", "اللون"));
    expect(entry!.nameVariants).toEqual([L("Colour", "اللون"), L("Color", "اللون")]);
    expect(entry!.values[0]!.value).toEqual(L("Red", "أحمر")); // 2 vs 1
  });

  it("breaks ties deterministically by en then ar, whatever order products are read in", () => {
    const a = { attributes: [attr("k", L("Beta", "ب"), [])] };
    const b = { attributes: [attr("k", L("Alpha", "ج"), [])] };
    const c = { attributes: [attr("k", L("Alpha", "أ"), [])] };
    for (const rows of [[a, b, c], [c, b, a], [b, a, c]]) {
      expect(buildAttributeCatalog(rows)[0]!.name).toEqual(L("Alpha", "أ"));
    }
  });

  it("sorts attributes and values by English name (Arabic or key as fallback), then key", () => {
    const catalog = buildAttributeCatalog([
      { attributes: [attr("z", L("zinc", ""), [["b", L("Banana", "")], ["a", L("apple", "")]]), attr("only-ar", L("", "مادة"), []), attr("a", L("Apple", ""), [])] },
    ]);
    expect(catalog.map((e) => e.key)).toEqual(["a", "z", "only-ar"]); // apple, zinc, then Arabic after Latin
    expect(catalog.find((e) => e.key === "z")!.values.map((v) => v.key)).toEqual(["a", "b"]);
  });

  it("tolerates a missing locale on a stored name", () => {
    const [entry] = buildAttributeCatalog([{ attributes: [{ key: "k", name: { en: "K" } as { en: string; ar: string }, values: [] }] }]);
    expect(entry!.name).toEqual({ en: "K", ar: "" });
  });
});
