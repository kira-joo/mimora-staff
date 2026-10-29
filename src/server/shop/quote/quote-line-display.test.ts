import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { resolveLineImage, resolveOptionLabels } from "./quote-line-display";

const image = (id: string) => ({ publicId: id }) as unknown as ImageAsset;

describe("resolveOptionLabels", () => {
  const axes = [
    { key: "colour", name: { en: "Colour", ar: "اللون" }, values: [{ key: "olive", label: { en: "Olive", ar: "زيتي" } }] },
    { key: "size", name: { en: "Size", ar: "المقاس" } },
  ];

  it("returns the axis name and value label in both locales", () => {
    expect(resolveOptionLabels([{ key: "colour", value: "olive" }], axes)).toEqual([{ axis: { en: "Colour", ar: "اللون" }, value: { en: "Olive", ar: "زيتي" } }]);
  });

  it("falls back to the raw value for an unlabelled value, and the raw key for an unknown axis", () => {
    expect(resolveOptionLabels([{ key: "size", value: "M" }, { key: "gone", value: "x" }], axes)).toEqual([
      { axis: { en: "Size", ar: "المقاس" }, value: { en: "M", ar: "M" } },
      { axis: { en: "gone", ar: "gone" }, value: { en: "x", ar: "x" } },
    ]);
  });
});

describe("resolveLineImage", () => {
  it("prefers the variant gallery, then the product image, then null", () => {
    expect(resolveLineImage([image("v")], [image("p")])).toEqual(image("v"));
    expect(resolveLineImage([], [image("p")])).toEqual(image("p"));
    expect(resolveLineImage(undefined, [])).toBeNull();
  });
});
