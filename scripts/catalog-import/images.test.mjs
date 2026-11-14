import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { imageInfo, imageProblem, inspectImages, suggestFile } from "./images.mjs";
import { png } from "./test-fixtures.mjs";

/** A minimal JPEG header with an SOF0 frame of the given size. */
function jpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

describe("imageInfo / imageProblem", () => {
  it("reads PNG and JPEG type and size from the bytes", () => {
    expect(imageInfo(png(300, 200))).toEqual({ mime: "image/png", width: 300, height: 200 });
    expect(imageInfo(jpeg(1280, 960))).toEqual({ mime: "image/jpeg", width: 1280, height: 960 });
    expect(imageInfo(Buffer.from("not an image at all, really"))).toBeNull();
  });

  it("applies the server's catalog image policy", () => {
    expect(imageProblem({ mime: "image/png", width: 300, height: 300 }, 1000)).toBeNull();
    expect(imageProblem(null, 10)).toBe("not a JPEG, PNG or WebP image");
    expect(imageProblem({ mime: "image/png", width: 150, height: 300 }, 1000)).toContain("below the 200px minimum");
    expect(imageProblem({ mime: "image/png", width: 9000, height: 300 }, 1000)).toContain("over the 8000px maximum");
    expect(imageProblem({ mime: "image/png", width: 300, height: 300 }, 9 * 1024 * 1024)).toContain("over the 8 MB limit");
  });
});

describe("suggestFile", () => {
  it("suggests the same name without a '(1)' copy marker — and only when exactly one file matches", () => {
    const available = ["photo_2026-11-14 18.50.25.jpeg", "photo_2026-11-14 18.50.27.jpeg"];
    expect(suggestFile("photo_2026-11-14 18.50.25(1).jpeg", available)).toBe("photo_2026-11-14 18.50.25.jpeg");
    expect(suggestFile("Photo_2026-11-14 18.50.27 (1).JPEG", available)).toBe("photo_2026-11-14 18.50.27.jpeg");
    expect(suggestFile("other.jpeg", available)).toBeNull();
  });
});

describe("inspectImages", () => {
  it("hashes existing files, reports missing ones with a suggestion, refuses paths outside the folder, and lists unused files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-images-"));
    fs.writeFileSync(path.join(dir, "a.png"), png(300, 300, 1));
    fs.writeFileSync(path.join(dir, "b.jpeg"), jpeg(400, 400));
    fs.writeFileSync(path.join(dir, "unused.png"), png(300, 300, 2));
    const { files, unused } = inspectImages(dir, ["a.png", "b(1).jpeg", "../a.png", "a.png"]);
    expect(files.get("a.png")).toMatchObject({ exists: true, mime: "image/png", width: 300, problem: null });
    expect(files.get("a.png").sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(files.get("b(1).jpeg")).toMatchObject({ exists: false, problem: "file not found", suggestion: "b.jpeg" });
    expect(files.get("../a.png")).toMatchObject({ exists: false, problem: "must be a file directly inside the import folder" });
    expect(unused).toEqual(["b.jpeg", "unused.png"]);
  });
});
