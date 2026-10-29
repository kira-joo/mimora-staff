import { describe, expect, it } from "vitest";
import type { Category } from "src/api/categories.endpoints";
import { reorderItems, siblingsOf } from "./category-tree";

const text = (en: string) => ({ en, ar: "" });
const category = (id: string, sortOrder: number, parentId?: string | null, name = id): Category => ({
  _id: id,
  name: text(name),
  description: text(""),
  slug: id,
  parentId,
  sortOrder,
  seoTitle: text(""),
  seoDescription: text(""),
  published: true,
});

describe("siblingsOf", () => {
  const all = [category("shirts", 2), category("dresses", 0, null), category("oxford", 1, "shirts"), category("linen", 0, "shirts"), category("bags", 1, undefined)];

  it("treats a missing and a null parent alike as the top level, in sortOrder", () => {
    expect(siblingsOf(all, null).map((c) => c._id)).toEqual(["dresses", "bags", "shirts"]);
  });

  it("returns only the direct children of a parent", () => {
    expect(siblingsOf(all, "shirts").map((c) => c._id)).toEqual(["linen", "oxford"]);
    expect(siblingsOf(all, "oxford")).toEqual([]);
  });

  it("breaks sortOrder ties by name, so an unordered list is still stable", () => {
    const tied = [category("b", 0, null, "Boots"), category("a", 0, null, "Anklets")];
    expect(siblingsOf(tied, null).map((c) => c._id)).toEqual(["a", "b"]);
  });

  it("does not reorder the input", () => {
    const input = [category("x", 1), category("y", 0)];
    siblingsOf(input, null);
    expect(input.map((c) => c._id)).toEqual(["x", "y"]);
  });
});

describe("reorderItems", () => {
  it("numbers ids by their new position", () => {
    expect(reorderItems(["c", "a", "b"])).toEqual([
      { categoryId: "c", sortOrder: 0 },
      { categoryId: "a", sortOrder: 1 },
      { categoryId: "b", sortOrder: 2 },
    ]);
  });
});
