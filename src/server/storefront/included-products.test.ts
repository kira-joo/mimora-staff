import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { includedProductsView, type IncludedProductSource } from "./included-products";

const id = () => new mongoose.Types.ObjectId();
const image = (publicId: string) => ({ provider: "cloudinary", publicId, secureUrl: `https://res.example/${publicId}.png` }) as never;
const product = (slug: string, extra: Partial<IncludedProductSource> = {}): IncludedProductSource => ({ _id: id(), slug, name: { en: slug, ar: `س ${slug}` }, images: [image(slug)], ...extra });
const entry = (p: IncludedProductSource, quantity: number) => ({ productId: p._id, quantity });
const ids = (items: ReturnType<typeof includedProductsView>) => items.map((i) => [i.slug, i.quantity]);

describe("includedProductsView", () => {
  it("is empty with no contents", () => {
    expect(includedProductsView(undefined, [product("a")])).toEqual([]);
    expect(includedProductsView([], [product("a")])).toEqual([]);
  });

  it("follows the stored order, not the order products were fetched, with quantities", () => {
    const a = product("a");
    const b = product("b");
    const c = product("c");
    expect(ids(includedProductsView([entry(c, 1), entry(a, 3), entry(b, 2)], [a, b, c]))).toEqual([["c", 1], ["a", 3], ["b", 2]]);
  });

  it("omits an entry whose product was not supplied (unpublished or gone)", () => {
    const a = product("a");
    const draft = product("draft");
    expect(ids(includedProductsView([entry(draft, 1), entry(a, 2), { productId: id(), quantity: 1 }], [a]))).toEqual([["a", 2]]);
  });

  it("carries the live name", () => {
    const a = product("a");
    expect(includedProductsView([entry(a, 1)], [a])[0].name).toEqual({ en: "a", ar: "س a" });
  });

  it("shows up to six gallery images, else the listing image, else none", () => {
    const many = product("many", { images: Array.from({ length: 9 }, (_, i) => image(`m${i}`)) });
    const listingOnly = product("listing", { images: [], listing: { primaryImage: image("listing-p") } });
    const bare = product("bare", { images: undefined });
    const [m, l, b] = includedProductsView([entry(many, 1), entry(listingOnly, 1), entry(bare, 1)], [many, listingOnly, bare]);
    expect(m.images).toHaveLength(6);
    expect(m.images.map((i) => (i as unknown as { publicId: string }).publicId)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5"]);
    expect(l.images.map((i) => (i as unknown as { publicId: string }).publicId)).toEqual(["listing-p"]);
    expect(b.images).toEqual([]);
  });
});
