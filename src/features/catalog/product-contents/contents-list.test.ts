import { describe, expect, it } from "vitest";
import { contentRowProblems, contentsBody, rowsOfContents, sameContents } from "./contents-list";

const item = (productId: string, quantity: number) => ({ productId, name: { en: productId, ar: productId }, slug: productId, lifecycle: "published" as const, quantity });

describe("contents list", () => {
  it("round-trips quantities as numbers in order", () => {
    expect(contentsBody(rowsOfContents([item("mug", 1), item("socks", 2)]))).toEqual({ items: [{ productId: "mug", quantity: 1 }, { productId: "socks", quantity: 2 }] });
  });

  it("flags bad quantities and self-inclusion", () => {
    const rows = rowsOfContents([item("mug", 1), item("box", 1)]);
    rows[0]!.quantity = "0";
    expect(contentRowProblems("box", rows)).toEqual(["Item 1: the quantity must be a whole number from 1 to 99.", "Item 2: a product cannot contain itself."]);
    rows[0]!.quantity = "1.5";
    expect(contentRowProblems("x", rows)).toHaveLength(1);
    rows[0]!.quantity = "100";
    expect(contentRowProblems("x", rows)).toHaveLength(1);
  });

  it("detects changes", () => {
    const items = [item("mug", 1)];
    const rows = rowsOfContents(items);
    expect(sameContents(rows, items)).toBe(true);
    rows[0]!.quantity = "2";
    expect(sameContents(rows, items)).toBe(false);
  });
});
