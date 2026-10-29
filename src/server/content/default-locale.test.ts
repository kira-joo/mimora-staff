import { describe, expect, it } from "vitest";
import { findMissingDefaultLocalePaths } from "./default-locale";

const L = (ar: string, en: string) => ({ ar, en });
const onlyName = (path: string) => path === "name";

describe("findMissingDefaultLocalePaths (D-11)", () => {
  it("passes when the default locale is filled and the secondary is not — publishing in Arabic first is allowed", () => {
    expect(findMissingDefaultLocalePaths({ name: L("قميص", ""), description: L("كتان", "") }, "ar", onlyName)).toEqual([]);
  });

  it("flags a required field missing its default locale, even when the secondary is filled", () => {
    expect(findMissingDefaultLocalePaths({ name: L("", "Shirt") }, "ar", onlyName)).toEqual(["name"]);
  });

  it("treats whitespace as missing", () => {
    expect(findMissingDefaultLocalePaths({ name: L("   ", "Shirt") }, "ar", onlyName)).toEqual(["name"]);
  });

  it("allows an optional field blank in both locales", () => {
    expect(findMissingDefaultLocalePaths({ name: L("قميص", ""), seoTitle: L("", "") }, "ar", onlyName)).toEqual([]);
  });

  it("flags an optional field filled only in the secondary locale — the 'English-only content' D-11 exists to stop", () => {
    expect(findMissingDefaultLocalePaths({ name: L("قميص", ""), description: L("", "Linen") }, "ar", onlyName)).toEqual(["description"]);
  });

  it("reports nested paths as form field paths", () => {
    const product = { name: L("قميص", "Shirt"), optionAxes: [{ key: "size", name: L("المقاس", "Size") }, { key: "colour", name: L("", "Colour") }] };
    expect(findMissingDefaultLocalePaths(product, "ar", onlyName)).toEqual(["optionAxes.1.name"]);
  });

  it("judges by the store's default locale — an English-default store needs English", () => {
    expect(findMissingDefaultLocalePaths({ name: L("قميص", "") }, "en", onlyName)).toEqual(["name"]);
    expect(findMissingDefaultLocalePaths({ name: L("", "Shirt") }, "en", onlyName)).toEqual([]);
  });

  it("ignores absent fields", () => {
    expect(findMissingDefaultLocalePaths({ name: L("قميص", ""), description: undefined }, "ar", onlyName)).toEqual([]);
  });
});
