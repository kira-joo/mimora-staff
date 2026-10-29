import { describe, expect, it } from "vitest";
import { FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { CURRENCY_CODE, blankToUndefined, disableFields, isHexColor, joinList, splitList, toOptionalWholeNumber } from "./settings-helpers";

describe("isHexColor", () => {
  it("accepts #RRGGBB, with surrounding space", () => {
    expect(isHexColor("#6B8F71")).toBe(true);
    expect(isHexColor(" #6b8f71 ")).toBe(true);
  });
  it("refuses #RGB (the engine cannot parse it) and everything the server's pattern refuses", () => {
    for (const bad of ["#fff", "fff", "#ffff", "#12345", "#gggggg", "rgb(0,0,0)", "", "#"]) expect(isHexColor(bad)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
    expect(isHexColor(12)).toBe(false);
  });
});

describe("CURRENCY_CODE", () => {
  it("is exactly three letters", () => {
    expect(CURRENCY_CODE.test("EGP")).toBe(true);
    expect(CURRENCY_CODE.test("egp")).toBe(true);
    for (const bad of ["EG", "EGPP", "E1P", "", "EG P"]) expect(CURRENCY_CODE.test(bad)).toBe(false);
  });
});

describe("toOptionalWholeNumber", () => {
  it("parses whole numbers and omits blanks", () => {
    expect(toOptionalWholeNumber("0")).toBe(0);
    expect(toOptionalWholeNumber(" 45 ")).toBe(45);
    expect(toOptionalWholeNumber("")).toBeUndefined();
    expect(toOptionalWholeNumber(undefined)).toBeUndefined();
  });
  it("never rounds or accepts a fraction or sign", () => {
    for (const bad of ["1.5", "-2", "1e3", "abc"]) expect(toOptionalWholeNumber(bad)).toBeUndefined();
  });
});

describe("blankToUndefined", () => {
  it("trims, and omits blanks", () => {
    expect(blankToUndefined("  x ")).toBe("x");
    expect(blankToUndefined("   ")).toBeUndefined();
  });
});

describe("splitList / joinList", () => {
  it("trims, drops empties, keeps the first of a duplicate and the order", () => {
    expect(splitList("owner, manager ,,owner,  support")).toEqual(["owner", "manager", "support"]);
    expect(splitList("")).toEqual([]);
    expect(splitList(undefined)).toEqual([]);
  });
  it("round-trips", () => {
    expect(splitList(joinList(["a", "b"]))).toEqual(["a", "b"]);
    expect(joinList(undefined)).toBe("");
  });
});

describe("disableFields", () => {
  const sections: FormSection<{ a: string; b: boolean }>[] = [{ title: "S", fields: [{ type: FieldType.INPUT, name: "a" }, { type: FieldType.SWITCH, name: "b" }] }];
  it("disables every field when read-only", () => {
    const out = disableFields(sections, true);
    expect(out[0]?.fields.every((f) => f.disabled === true)).toBe(true);
  });
  it("returns the sections untouched when the role can edit", () => {
    expect(disableFields(sections, false)).toBe(sections);
    expect(sections[0]?.fields[0]?.disabled).toBeUndefined();
  });
});
