import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { linkedProductsView, type GroupSibling } from "./linked-products";

const id = () => new mongoose.Types.ObjectId();
const image = (publicId: string) => ({ provider: "cloudinary", publicId, secureUrl: `https://res.example/${publicId}.png` }) as never;
const sibling = (slug: string, en: string, ar: string, extra: Partial<GroupSibling> = {}): GroupSibling => ({
  _id: id(),
  slug,
  name: { en: `${en} Plush Slippers`, ar: `شبشب ${ar}` },
  images: [image(slug)],
  group: { label: { en, ar }, order: 0 },
  ...extra,
});

describe("linkedProductsView", () => {
  it("lists every member in the given order, marking the current one", () => {
    const brown = sibling("brown", "Brown", "بني");
    const pink = sibling("pink", "Pink", "وردي");
    const cream = sibling("cream", "Cream", "كريمي");
    const view = linkedProductsView(pink._id, [brown, pink, cream]);
    expect(view?.items.map((item) => [item.slug, item.label.en, item.label.ar, item.current])).toEqual([
      ["brown", "Brown", "بني", false],
      ["pink", "Pink", "وردي", true],
      ["cream", "Cream", "كريمي", false],
    ]);
  });

  it("uses the first gallery image, else the listing image", () => {
    const withGallery = sibling("a", "A", "أ");
    const listingOnly = sibling("b", "B", "ب", { images: [], listing: { primaryImage: image("listing-b") } });
    const view = linkedProductsView(withGallery._id, [withGallery, listingOnly]);
    expect(view?.items.map((item) => (item.image as unknown as { publicId: string } | undefined)?.publicId)).toEqual(["a", "listing-b"]);
  });

  it("is null when there is nothing to switch to: no members, only the current one, or the current one missing", () => {
    const only = sibling("only", "Only", "وحيد");
    expect(linkedProductsView(only._id, [])).toBeNull();
    expect(linkedProductsView(only._id, [only])).toBeNull();
    expect(linkedProductsView(id(), [sibling("x", "X", "س"), sibling("y", "Y", "ص")])).toBeNull();
  });

  it("falls back to the product name when a member has no label", () => {
    const a = sibling("a", "A", "أ", { group: undefined });
    const b = sibling("b", "B", "ب");
    expect(linkedProductsView(b._id, [a, b])?.items[0]?.label).toEqual(a.name);
  });
});
