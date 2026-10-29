import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { BRAND_IMAGE_UPLOAD_POLICY, CATALOG_IMAGE_UPLOAD_POLICY, FAVICON_UPLOAD_POLICY } from "src/server/core/assets/upload-policies";
import { acceptFor, describeDimensions, moveImage, precheckImage, removeImageAt, sameGallery, toggleGalleryPick } from "./image-gallery";

const img = (publicId: string) => ({ publicId }) as ImageAsset;
const ids = (images: readonly { publicId: string }[]) => images.map((i) => i.publicId);

describe("moveImage", () => {
  it("moves forward and back, and the first position is the primary", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveImage(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveImage(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
  });
  it("clamps past either end, ignores a bad index, and never mutates", () => {
    const list = ["a", "b", "c"];
    expect(moveImage(list, 0, -5)).toEqual(["a", "b", "c"]);
    expect(moveImage(list, 0, 99)).toEqual(["b", "c", "a"]);
    expect(moveImage(list, 7, 0)).toEqual(["a", "b", "c"]);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("removeImageAt / sameGallery", () => {
  it("removes one by position", () => expect(removeImageAt(["a", "b", "c"], 1)).toEqual(["a", "c"]));
  it("treats a reorder as a change, and identical order as none", () => {
    expect(sameGallery([img("a"), img("b")], [img("a"), img("b")])).toBe(true);
    expect(sameGallery([img("a"), img("b")], [img("b"), img("a")])).toBe(false);
    expect(sameGallery([img("a")], [])).toBe(false);
  });
});

describe("precheckImage — the same policy objects the server enforces", () => {
  const file = (type: string, size: number, name = "photo.png") => ({ type, size, name });
  it("accepts an allowed type within the size", () => expect(precheckImage(file("image/png", 1000), CATALOG_IMAGE_UPLOAD_POLICY)).toBeUndefined());
  it("refuses a type outside the policy and names the allowed ones", () => {
    expect(precheckImage(file("image/gif", 1000, "anim.gif"), CATALOG_IMAGE_UPLOAD_POLICY)).toMatch(/"anim.gif" is not a supported image type\. Use JPG, PNG, WEBP\./);
  });
  it("refuses an oversize file, with the real limit — each slot has its own", () => {
    expect(precheckImage(file("image/png", 9 * 1024 * 1024), CATALOG_IMAGE_UPLOAD_POLICY)).toMatch(/limit is 8 MB/);
    expect(precheckImage(file("image/png", 2 * 1024 * 1024), FAVICON_UPLOAD_POLICY)).toMatch(/limit is 1 MB/);
    expect(precheckImage(file("image/png", 2 * 1024 * 1024), BRAND_IMAGE_UPLOAD_POLICY)).toBeUndefined();
  });
});

describe("policy text", () => {
  it("builds accept from the policy and describes its dimension limits", () => {
    expect(acceptFor(FAVICON_UPLOAD_POLICY)).toBe("image/png,image/webp,image/jpeg");
    expect(describeDimensions(CATALOG_IMAGE_UPLOAD_POLICY)).toBe("At least 200 × 200 px, at most 8000 × 8000 px.");
    expect(describeDimensions({ allowedMimeTypes: [], allowedFormats: [], maxBytes: 1 })).toBeUndefined();
  });
});

describe("toggleGalleryPick", () => {
  const gallery = [img("a"), img("b"), img("c")];
  it("adds a pick and keeps the product gallery's order, not the order of clicking", () => {
    const first = toggleGalleryPick(gallery, [], gallery[2]!);
    expect(ids(toggleGalleryPick(gallery, first, gallery[0]!))).toEqual(["a", "c"]);
  });
  it("removes a pick that is already chosen", () => {
    expect(ids(toggleGalleryPick(gallery, [img("a"), img("b")], gallery[0]!))).toEqual(["b"]);
  });
  it("drops a pick the product no longer has", () => {
    expect(ids(toggleGalleryPick(gallery, [img("gone"), img("a")], gallery[1]!))).toEqual(["a", "b"]);
  });
});
