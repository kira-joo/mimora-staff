import { describe, expect, it } from "vitest";
import { buildAttributeCatalog } from "./attribute-catalog";
import { attributeIdentityProblems } from "./attribute-identity";

const L = (en: string, ar: string) => ({ en, ar });
const catalog = buildAttributeCatalog([
  { attributes: [{ key: "color", name: L("Color", "اللون"), values: [{ key: "red", value: L("Red", "أحمر") }] }, { key: "fit", name: L("Size", "المقاس"), values: [] }] },
  { attributes: [{ key: "color", name: L("Colour", "اللون"), values: [] }] },
]);
const attr = (key: string, en: string, ar: string) => ({ key, name: L(en, ar) });

describe("attributeIdentityProblems", () => {
  it("passes an existing key, whatever its name says", () => {
    expect(attributeIdentityProblems([attr("color", "Totally different", "مختلف")], catalog)).toEqual([]);
  });

  it("passes a genuinely new attribute", () => {
    expect(attributeIdentityProblems([attr("material", "Material", "الخامة")], catalog)).toEqual([]);
  });

  it("refuses a new key whose English name equals an existing name under another key", () => {
    expect(attributeIdentityProblems([attr("colour", "Color", "")], catalog)).toEqual(['An attribute named "Color" already exists (key "color") — select it instead.']);
  });

  it("checks every name variant, plural-stripped and case-insensitive", () => {
    expect(attributeIdentityProblems([attr("colours", "COLOURS", "")], catalog)).toHaveLength(1);
  });

  it("refuses on the Arabic name alone (article and hamza insensitive)", () => {
    const problems = attributeIdentityProblems([attr("lawn", "", "لون")], catalog);
    expect(problems).toEqual(['An attribute named "لون" already exists (key "color") — select it instead.']);
  });

  it("does not block a merely near name (warning territory, not a refusal)", () => {
    expect(attributeIdentityProblems([attr("shade", "Colorr", "")], catalog)).toEqual([]);
  });

  it("a blank name never clashes", () => {
    expect(attributeIdentityProblems([attr("x", "", "")], catalog)).toEqual([]);
  });

  it("keys the product already carries are exempt even if absent from the catalog", () => {
    expect(attributeIdentityProblems([attr("legacy", "Color", "")], catalog, ["legacy"])).toEqual([]);
    expect(attributeIdentityProblems([attr("legacy", "Color", "")], catalog)).toHaveLength(1);
  });

  it("refuses two NEW attributes with the same name in one save (Codex review)", () => {
    expect(attributeIdentityProblems([attr("fabric", "Fabric", "القماش"), attr("fabrics", "Fabrics", "")], catalog)).toEqual(['Two new attributes are both named "Fabrics" (keys "fabric" and "fabrics") — keep one.']);
    expect(attributeIdentityProblems([attr("fabric", "Fabric", ""), attr("cloth", "Cloth", "قماش")], catalog)).toEqual([]);
  });

  it("reports one problem per offending attribute", () => {
    expect(attributeIdentityProblems([attr("a", "Color", ""), attr("fit", "x", ""), attr("b", "", "المقاس")], catalog)).toHaveLength(2);
  });
});
