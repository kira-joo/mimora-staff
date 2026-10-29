import { describe, expect, it } from "vitest";
import { MAX_SEARCH_TOKENS, buildSearchPattern, normalizeSearchText, searchRegex, searchTokens } from "./normalize-search-text";

describe("normalizeSearchText", () => {
  it("strips tashkeel", () => {
    expect(normalizeSearchText("مُحَمَّد")).toBe("محمد");
  });

  it("strips tatweel", () => {
    expect(normalizeSearchText("جـــميل")).toBe("جميل");
  });

  it("unifies every alef form to bare alef", () => {
    expect(normalizeSearchText("أحمد إبراهيم آمن ٱسم")).toBe("احمد ابراهيم امن اسم");
  });

  it("folds alef maqsura to yeh and teh marbuta to heh", () => {
    expect(normalizeSearchText("مستشفى")).toBe("مستشفي");
    expect(normalizeSearchText("مدرسة")).toBe("مدرسه");
  });

  it("maps Arabic-Indic and extended digits to Latin digits", () => {
    expect(normalizeSearchText("مقاس ٤٢ و ۴۲")).toBe("مقاس 42 و 42");
  });

  it("case-folds Latin text and collapses whitespace", () => {
    expect(normalizeSearchText("  Red   SHIRT ")).toBe("red shirt");
  });

  it("leaves text that needs no normalising unchanged", () => {
    expect(normalizeSearchText("قميص")).toBe("قميص");
  });
});

describe("searchTokens", () => {
  it("splits and normalises", () => {
    expect(searchTokens("  أحذية  Nike ")).toEqual(["احذيه", "nike"]);
  });

  it("is empty for nothing, whitespace, or only marks", () => {
    expect(searchTokens(undefined)).toEqual([]);
    expect(searchTokens("   ")).toEqual([]);
    expect(searchTokens("ـَُّ")).toEqual([]);
  });

  it("is bounded", () => {
    expect(searchTokens(Array.from({ length: 30 }, (_, i) => `t${i}`).join(" "))).toHaveLength(MAX_SEARCH_TOKENS);
    expect(searchTokens("x".repeat(500))[0]).toHaveLength(100);
  });
});

describe("buildSearchPattern", () => {
  const matches = (token: string, text: string) => searchRegex(token).test(text);

  it("finds a word written with different alef, yeh and heh spellings", () => {
    expect(matches("احمد", "أحمد")).toBe(true);
    expect(matches("أحمد", "احمد")).toBe(true);
    expect(matches("مدرسه", "مدرسة")).toBe(true);
    expect(matches("مستشفي", "مستشفى")).toBe(true);
  });

  it("finds a word through tashkeel and tatweel in the stored text", () => {
    expect(matches("محمد", "مُحَمَّد")).toBe(true);
    expect(matches("جميل", "جـــميل")).toBe(true);
  });

  it("matches inside a longer text", () => {
    expect(matches("قميص", "قميص قطني أحمر")).toBe(true);
  });

  it("does not match different letters", () => {
    expect(matches("قميص", "قبعة")).toBe(false);
  });

  it("is case-insensitive for Latin and treats Arabic-Indic digits as digits", () => {
    expect(matches("nike", "NIKE Air")).toBe(true);
    expect(matches("42", "مقاس ٤٢")).toBe(true);
  });

  it("escapes regex metacharacters — a query is never a pattern", () => {
    expect(() => searchRegex("(a+")).not.toThrow();
    expect(matches("a.c", "abc")).toBe(false);
    expect(matches("a.c", "a.c")).toBe(true);
    expect(matches(".*", "anything")).toBe(false);
    expect(buildSearchPattern("a|b")).toContain("\\|");
  });

  it("emits literal characters, never \\uXXXX escapes — MongoDB's PCRE2 rejects them", () => {
    expect(buildSearchPattern("أحمد 4")).not.toMatch(/\\u/);
  });

  it("agrees with the normalised-containment definition on a spread of spellings", () => {
    const texts = ["أحمد", "اِحْمَد", "إبراهيم", "آمنة", "مدرســـة", "مستشفى", "قميص ٤٢", "Red Shirt", "حذاءٌ رياضي", "قطن (100%)"];
    const queries = ["احمد", "أحمد", "ابراهيم", "امنه", "مدرسه", "مستشفي", "42", "red", "حذاء", "(100", "رياضي", "غير", "ة"];
    for (const text of texts) {
      for (const query of queries) {
        const [token] = searchTokens(query);
        const viaRegex = token ? matches(token, text) : false;
        const viaNormalised = token ? normalizeSearchText(text).includes(token) : false;
        expect({ text, query, viaRegex }).toEqual({ text, query, viaRegex: viaNormalised });
      }
    }
  });
});
