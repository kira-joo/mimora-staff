import { describe, expect, it } from "vitest";
import { findSimilar, findSimilarValues, levenshtein, normalizeAttributeName, searchAttributes } from "./attribute-similarity";

const entry = (key: string, en: string, ar: string) => ({ key, name: { en, ar } });
const candidate = (key: string, en: string, ar: string) => ({ key, en, ar });

describe("normalizeAttributeName", () => {
  it.each([
    ["  Color ", "color"],
    ["COLOR", "color"],
    ["Colors", "color"], // trailing s
    ["Boxes", "box"], // trailing es
    ["Fit", "fit"], // short words keep their s-ending
    ["Gas", "gas"],
    ["Care & Wash", "carewash"],
    ["اللون", "لون"], // article
    ["الألوان", "الوان"],
    ["اللَّوْن", "لون"], // diacritics
    ["لـــون", "لون"], // tatweel
    ["إسم", "اسم"], // hamza forms
    ["أنواع", "انواع"],
    ["مدرسة", "مدرسه"], // ta marbuta
    ["مستشفى", "مستشفي"], // alef maqsura
    ["", ""],
    ["--", ""],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeAttributeName(input)).toBe(expected);
  });
});

describe("levenshtein", () => {
  it("counts edits and stops early past the bound", () => {
    expect(levenshtein("color", "colour")).toBe(1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abcdefgh", 2)).toBe(3);
  });
});

describe("findSimilar — English", () => {
  const catalog = [entry("color", "Color", "اللون"), entry("fit", "Fit", "القصة")];

  it("Color vs Colours: not exact, but flagged near (colour is one edit from color after plural stripping)", () => {
    const result = findSimilar(candidate("colours", "Colours", ""), catalog);
    // "colours" -> "colour"; its key normalises the same, and "colour" is not "color".
    expect(result.exact).toEqual([]);
    expect(result.near.map((e) => e.key)).toEqual(["color"]);
  });

  it("Colors is exact after plural stripping", () => {
    expect(findSimilar(candidate("colors", "Colors", ""), catalog).exact.map((e) => e.key)).toEqual(["color"]);
  });

  it("the same key is exact even when the names differ", () => {
    expect(findSimilar(candidate("fit", "Anything", "أي شيء"), catalog).exact.map((e) => e.key)).toEqual(["fit"]);
  });

  it("Size vs Fit is not flagged at all", () => {
    expect(findSimilar(candidate("size", "Size", "المقاس"), catalog)).toEqual({ exact: [], near: [] });
  });

  it("a blank candidate matches nothing — empty names are never 'equal'", () => {
    expect(findSimilar(candidate("", "", ""), [entry("x", "", "")])).toEqual({ exact: [], near: [] });
  });

  it("an empty language on either side is never compared", () => {
    expect(findSimilar(candidate("size", "Size", ""), [entry("fit", "Fit", "")]).exact).toEqual([]);
  });

  it("short words: one edit is near, two are not", () => {
    expect(findSimilar(candidate("fat", "Fat", ""), catalog).near.map((e) => e.key)).toEqual(["fit"]);
    expect(findSimilar(candidate("fix", "Fix", ""), [entry("fat", "Fat", "")]).near).toEqual([]);
  });
});

describe("findSimilar — Arabic", () => {
  const catalog = [entry("color", "Color", "اللون"), entry("material", "Material", "الخامة")];

  it("اللون vs لون is exact (article stripped)", () => {
    expect(findSimilar(candidate("x", "", "لون"), catalog).exact.map((e) => e.key)).toEqual(["color"]);
  });

  it("اللون vs الألوان (broken plural) is flagged near", () => {
    const result = findSimilar(candidate("alwan", "", "الألوان"), catalog);
    expect(result.exact).toEqual([]);
    expect(result.near.map((e) => e.key)).toEqual(["color"]);
  });

  it("diacritics, hamza and ta marbuta variants are exact", () => {
    expect(findSimilar(candidate("x", "", "الخَامَه"), catalog).exact.map((e) => e.key)).toEqual(["material"]);
  });

  it("an unrelated Arabic name is not flagged", () => {
    expect(findSimilar(candidate("size", "", "المقاس"), catalog)).toEqual({ exact: [], near: [] });
  });

  it("Arabic text never matches an English name", () => {
    expect(findSimilar(candidate("x", "", "لون"), [entry("fit", "Fit", "")])).toEqual({ exact: [], near: [] });
  });
});

describe("findSimilarValues", () => {
  const values = [
    { key: "red", value: { en: "Red", ar: "أحمر" } },
    { key: "navy", value: { en: "Navy blue", ar: "كحلي" } },
  ];

  it("an existing value is exact and returned as the original object", () => {
    const result = findSimilarValues({ key: "", en: "red", ar: "" }, values);
    expect(result.exact).toEqual([values[0]]);
    expect(result.exact[0]).toBe(values[0]);
  });

  it("a typo is near, never exact", () => {
    const result = findSimilarValues({ key: "", en: "Navy bluee", ar: "" }, values);
    expect(result.exact).toEqual([]);
    expect(result.near).toEqual([values[1]]);
  });

  it("matches by Arabic label", () => {
    expect(findSimilarValues({ key: "", en: "", ar: "احمر" }, values).exact).toEqual([values[0]]);
  });

  it("a different value is not flagged", () => {
    expect(findSimilarValues({ key: "", en: "Green", ar: "أخضر" }, values)).toEqual({ exact: [], near: [] });
  });
});

describe("searchAttributes", () => {
  const entries = [
    { key: "color", name: { en: "Color", ar: "اللون" } },
    { key: "material", name: { en: "Material", ar: "الخامة" } },
    { key: "fit", name: { en: "Size", ar: "المقاس" } },
  ];
  const keys = (search: string) => searchAttributes(entries, search).map((entry) => entry.key);

  it("lists everything for an empty search, and substring hits in either language or by key", () => {
    expect(keys("")).toEqual(["color", "material", "fit"]);
    expect(keys("mat")).toEqual(["material"]);
    expect(keys("الخامة")).toEqual(["material"]);
    expect(keys("fit")).toEqual(["fit"]);
  });

  it("finds an existing attribute under a different spelling (the point of standardizing)", () => {
    expect(keys("colour")).toContain("color");
    expect(keys("Colors")).toContain("color");
    expect(keys("الألوان")).toContain("color");
    expect(keys("لون")).toContain("color");
  });

  it("does not drag in unrelated attributes", () => {
    expect(keys("colour")).not.toContain("material");
    expect(keys("Lining")).toEqual([]);
  });
});
