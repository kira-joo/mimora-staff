import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { MAX_CONTENT_ITEMS, contentsProblems } from "./product-contents-rules";

const id = () => new mongoose.Types.ObjectId().toString();

describe("contentsProblems", () => {
  const box = id();

  it("accepts an empty list and a valid one, including the quantity bounds", () => {
    expect(contentsProblems(box, [])).toEqual([]);
    expect(contentsProblems(box, [{ productId: id(), quantity: 1 }, { productId: id(), quantity: 99 }])).toEqual([]);
  });

  it("refuses a product containing itself", () => {
    expect(contentsProblems(box, [{ productId: id(), quantity: 1 }, { productId: box, quantity: 1 }])).toEqual(["Item 2 is the product itself — a product cannot contain itself."]);
  });

  it("refuses the same product twice", () => {
    const a = id();
    expect(contentsProblems(box, [{ productId: a, quantity: 1 }, { productId: a, quantity: 2 }])).toEqual(["Item 2 is already listed — raise its quantity instead."]);
  });

  it.each([0, -1, 100, 1.5, Number.NaN, Infinity])("refuses quantity %s", (quantity) => {
    expect(contentsProblems(box, [{ productId: id(), quantity }])).toEqual(["Item 1 needs a whole quantity from 1 to 99."]);
  });

  it("refuses a non-numeric quantity", () => {
    expect(contentsProblems(box, [{ productId: id(), quantity: "2" as unknown as number }])).toHaveLength(1);
  });

  it("refuses an invalid or empty product id", () => {
    expect(contentsProblems(box, [{ productId: "nope", quantity: 1 }, { productId: "", quantity: 1 }])).toEqual(["Item 1 is not a valid product.", "Item 2 is not a valid product."]);
  });

  it("caps the list", () => {
    const items = Array.from({ length: MAX_CONTENT_ITEMS + 1 }, () => ({ productId: id(), quantity: 1 }));
    expect(contentsProblems(box, items)).toEqual([`A product can list at most ${MAX_CONTENT_ITEMS} included products.`]);
    expect(contentsProblems(box, items.slice(0, MAX_CONTENT_ITEMS))).toEqual([]);
  });
});
