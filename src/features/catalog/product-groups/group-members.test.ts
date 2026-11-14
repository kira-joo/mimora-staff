import { describe, expect, it } from "vitest";
import type { ProductGroup } from "src/api/product-groups.endpoints";
import { addRow, membersChanged, moveRow, rowsOf, toInputs, withProduct, withoutProduct } from "./group-members";

const member = (productId: string, en: string, ar: string, order: number) => ({ productId, name: { en: `${en} slippers`, ar: `شبشب ${ar}` }, slug: productId, lifecycle: "published" as const, label: { en, ar }, order });
const group: ProductGroup = { _id: "g1", name: { en: "Slippers", ar: "شباشب" }, revision: 3, members: [member("brown", "Brown", "بني", 0), member("pink", "Pink", "وردي", 1)] };

describe("rows and inputs", () => {
  it("round-trips the saved membership in order, as copies", () => {
    const rows = rowsOf(group);
    expect(toInputs(rows)).toEqual([
      { productId: "brown", label: { en: "Brown", ar: "بني" } },
      { productId: "pink", label: { en: "Pink", ar: "وردي" } },
    ]);
    rows[0]!.label.en = "Changed";
    expect(group.members[0]!.label.en).toBe("Brown");
  });

  it("detects reorder, relabel and add/remove as changes", () => {
    expect(membersChanged(rowsOf(group), group)).toBe(false);
    expect(membersChanged(moveRow(rowsOf(group), 0, 1), group)).toBe(true);
    const relabelled = rowsOf(group);
    relabelled[1]!.label.ar = "زهري";
    expect(membersChanged(relabelled, group)).toBe(true);
    expect(membersChanged(rowsOf(group).slice(1), group)).toBe(true);
  });
});

describe("moveRow", () => {
  it("swaps with the neighbour and ignores moves past either end", () => {
    expect(moveRow(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveRow(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("addRow", () => {
  it("appends a new product once", () => {
    const rows = rowsOf(group);
    const cream = { ...member("cream", "Cream", "كريمي", 0), label: { en: "", ar: "" } };
    expect(addRow(rows, cream).map((r) => r.productId)).toEqual(["brown", "pink", "cream"]);
    expect(addRow(rows, { ...cream, productId: "pink" })).toBe(rows);
  });
});

describe("product-page edits", () => {
  it("withProduct relabels a member in place, or appends a newcomer last", () => {
    expect(withProduct(group, "pink", { en: "Rose", ar: "زهري" })).toEqual([
      { productId: "brown", label: { en: "Brown", ar: "بني" } },
      { productId: "pink", label: { en: "Rose", ar: "زهري" } },
    ]);
    expect(withProduct(group, "cream", { en: "Cream", ar: "كريمي" }).map((i) => i.productId)).toEqual(["brown", "pink", "cream"]);
  });

  it("withoutProduct keeps everyone else as loaded", () => {
    expect(withoutProduct(group, "brown")).toEqual([{ productId: "pink", label: { en: "Pink", ar: "وردي" } }]);
  });
});
