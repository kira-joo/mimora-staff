import { describe, expect, it } from "vitest";
import { MAX_GROUP_LABEL_LENGTH, MAX_GROUP_MEMBERS, groupNameProblem, membershipProblems, normalizeMembers } from "./product-group-rules";

const member = (productId: string, en: string, ar: string) => ({ productId, label: { en, ar } });

describe("membershipProblems", () => {
  it("accepts an empty group and a valid list", () => {
    expect(membershipProblems([])).toEqual([]);
    expect(membershipProblems([member("a", "Brown", "بني"), member("b", "Pink", "وردي")])).toEqual([]);
  });

  it("requires a label in both languages, after trimming", () => {
    expect(membershipProblems([member("a", " ", "بني"), member("b", "Pink", "")])).toEqual(["Product 1 needs an English label.", "Product 2 needs an Arabic label."]);
  });

  it("refuses the same product twice", () => {
    expect(membershipProblems([member("a", "Brown", "بني"), member("a", "Pink", "وردي")])).toContain("Product 2 is already in this group.");
  });

  it("refuses two members with the same label (case-insensitive, per language)", () => {
    expect(membershipProblems([member("a", "Pink", "وردي"), member("b", "pink ", "زهري")])).toEqual(['Product 2 has the same English label as product 1 ("pink").']);
    expect(membershipProblems([member("a", "Pink", "وردي"), member("b", "Rose", "وردي")])).toEqual(['Product 2 has the same Arabic label as product 1 ("وردي").']);
  });

  it("accepts a label of exactly 80 characters in either language", () => {
    expect(MAX_GROUP_LABEL_LENGTH).toBe(80);
    expect(membershipProblems([member("a", "x".repeat(80), "ب".repeat(80))])).toEqual([]);
  });

  it("refuses a label of 81 characters in either language", () => {
    expect(membershipProblems([member("a", "x".repeat(81), "بني")])).toEqual(["Product 1's English label is longer than 80 characters."]);
    expect(membershipProblems([member("a", "Brown", "ب".repeat(81))])).toEqual(["Product 1's Arabic label is longer than 80 characters."]);
  });

  it("measures the label after trimming", () => {
    expect(membershipProblems([member("a", ` ${"x".repeat(80)} `, "بني")])).toEqual([]);
  });

  it("caps group size", () => {
    const many = Array.from({ length: MAX_GROUP_MEMBERS + 1 }, (_, i) => member(`p${i}`, `L${i}`, `ل${i}`));
    expect(membershipProblems(many)).toEqual([`A group can hold at most ${MAX_GROUP_MEMBERS} products.`]);
  });

  it("refuses a member with no product", () => {
    expect(membershipProblems([member(" ", "Brown", "بني")])).toEqual(["Product 1 has no product."]);
  });
});

describe("normalizeMembers", () => {
  it("trims ids and labels without touching the input", () => {
    const input = [member(" a ", " Brown ", " بني ")];
    expect(normalizeMembers(input)).toEqual([member("a", "Brown", "بني")]);
    expect(input[0]!.label.en).toBe(" Brown ");
  });
});

describe("groupNameProblem", () => {
  it("needs a name in at least one language, within the length cap", () => {
    expect(groupNameProblem({ en: "", ar: " " })).toBe("Give the group a name.");
    expect(groupNameProblem(undefined)).toBe("Give the group a name.");
    expect(groupNameProblem({ en: "Plush Bow Slippers", ar: "" })).toBeNull();
    expect(groupNameProblem({ en: "", ar: "شباشب" })).toBeNull();
    expect(groupNameProblem({ en: "x".repeat(121), ar: "" })).toMatch(/at most 120/);
  });
});
