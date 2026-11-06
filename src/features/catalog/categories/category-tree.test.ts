import { describe, expect, it } from "vitest";
import type { Category } from "src/api/categories.endpoints";
import { categoryOptions, publishedForParent, reorderItems, siblingsOf } from "./category-tree";

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

describe("categoryOptions", () => {
  const all = [
    category("accessories", 1, null, "Accessories"),
    category("winter", 2, "accessories", "Winter Accessories"),
    category("jewelry", 0, "accessories", "Jewelry"),
    category("rings", 0, "jewelry", "Rings"),
    category("mugs", 0, null, "Mugs & Cups"),
  ];

  it("lists the tree depth-first in storefront order, each labelled with its full path", () => {
    expect(categoryOptions(all)).toEqual([
      { value: "mugs", label: "Mugs & Cups" },
      { value: "accessories", label: "Accessories" },
      { value: "jewelry", label: "Accessories › Jewelry" },
      { value: "rings", label: "Accessories › Jewelry › Rings" },
      { value: "winter", label: "Accessories › Winter Accessories" },
    ]);
  });

  it("leaves out a category and its whole subtree — the parents it may not move under", () => {
    expect(categoryOptions(all, { excludeSubtreeOf: "jewelry" }).map((option) => option.value)).toEqual(["mugs", "accessories", "winter"]);
  });

  it("marks unpublished categories, and keeps one whose parent is not in the list", () => {
    const hidden = { ...category("socks", 3, null, "Socks"), published: false };
    const stray = category("stray", 0, "gone", "Stray");
    expect(categoryOptions([hidden, stray]).map((option) => option.label)).toEqual(["Socks (unpublished)", "Stray"]);
  });
});

describe("publishedForParent — the category form's publish default when the parent changes", () => {
  it("creating: follows the parent — published under a published parent, unpublished under an unpublished one", () => {
    expect(publishedForParent({ mode: "create", parentPublished: true, published: false })).toBe(true);
    expect(publishedForParent({ mode: "create", parentPublished: false, published: true })).toBe(false);
  });

  it("creating at the top level defaults to published", () => {
    expect(publishedForParent({ mode: "create", parentPublished: null, published: false })).toBe(true);
  });

  it("editing: switches off only when the new parent is unpublished, and never publishes on its own", () => {
    expect(publishedForParent({ mode: "edit", parentPublished: false, published: true })).toBe(false);
    expect(publishedForParent({ mode: "edit", parentPublished: true, published: false })).toBe(false);
    expect(publishedForParent({ mode: "edit", parentPublished: true, published: true })).toBe(true);
    expect(publishedForParent({ mode: "edit", parentPublished: null, published: false })).toBe(false);
  });

  it("leaves the switch alone while the parent's state isn't known yet", () => {
    expect(publishedForParent({ mode: "create", parentPublished: undefined, published: true })).toBe(true);
    expect(publishedForParent({ mode: "edit", parentPublished: undefined, published: false })).toBe(false);
  });
});
