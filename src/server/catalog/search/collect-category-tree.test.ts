import { describe, expect, it } from "vitest";
import { collectCategoryTreeIds } from "./collect-category-tree";

const node = (id: string, parentId?: string, published = true) => ({ _id: id, parentId, published });

describe("collectCategoryTreeIds", () => {
  it("includes the root and published descendants at every depth", () => {
    const tree = [node("a"), node("b", "a"), node("c", "b"), node("x")];
    expect(collectCategoryTreeIds("a", tree).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not descend through an unpublished category", () => {
    const tree = [node("a"), node("b", "a", false), node("c", "b")];
    expect(collectCategoryTreeIds("a", tree)).toEqual(["a"]);
  });

  it("a leaf is just itself, and a parentId cycle terminates", () => {
    expect(collectCategoryTreeIds("z", [node("z")])).toEqual(["z"]);
    expect(collectCategoryTreeIds("a", [node("a", "b"), node("b", "a")]).sort()).toEqual(["a", "b"]);
  });
});
