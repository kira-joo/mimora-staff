import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { validateUploadedFile } from "@kira-joo/backend-toolkit-next";
import { describe, expect, it } from "vitest";
import { CATALOG_IMAGE_UPLOAD_POLICY, PAYMENT_PROOF_UPLOAD_POLICY } from "./upload-policies";

/**
 * Verifies this app's upload policies wire correctly into the toolkit's
 * existing `validateUploadedFile` — no network, no Cloudinary credentials
 * needed, since validation happens before any upload call. The actual
 * Cloudinary round-trip (`assetProvider()`/`privateAssets()`) is NOT
 * exercised here — it needs real credentials and is out of what this
 * integration test can verify; see the Phase 4A.5 completion report for
 * what remains manually/environment-dependent.
 */
describe("CATALOG_IMAGE_UPLOAD_POLICY", () => {
  it("rejects an image below the configured minimum dimensions — the 1×1 fixture genuinely fails CATALOG_IMAGE_UPLOAD_POLICY's 200×200 floor", () => {
    expect(() =>
      validateUploadedFile({ buffer: pngBuffer(), filename: "a.jpg", mimeType: "image/jpeg", size: 1024 }, CATALOG_IMAGE_UPLOAD_POLICY)
    ).toThrow(/below the minimum/);
  });

  it("rejects an unsupported mime type", () => {
    expect(() =>
      validateUploadedFile({ buffer: pngBuffer(), filename: "a.gif", mimeType: "image/gif", size: 1024 }, CATALOG_IMAGE_UPLOAD_POLICY)
    ).toThrow(BadRequestError);
  });

  it("rejects a file over the size limit", () => {
    expect(() =>
      validateUploadedFile(
        { buffer: pngBuffer(), filename: "a.jpg", mimeType: "image/jpeg", size: CATALOG_IMAGE_UPLOAD_POLICY.maxBytes + 1 },
        CATALOG_IMAGE_UPLOAD_POLICY
      )
    ).toThrow(BadRequestError);
  });
});

describe("PAYMENT_PROOF_UPLOAD_POLICY", () => {
  it("allows HEIC — a real iOS camera-upload format", () => {
    expect(PAYMENT_PROOF_UPLOAD_POLICY.allowedMimeTypes).toContain("image/heic");
  });

  it("never rejects a genuine small receipt: a real 1×1 image passes", () => {
    expect(() =>
      validateUploadedFile({ buffer: pngBuffer(), filename: "r.png", mimeType: "image/png", size: 68 }, PAYMENT_PROOF_UPLOAD_POLICY)
    ).not.toThrow();
  });

  it.each([
    ["PDF bytes labelled image/jpeg", Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF"), "image/jpeg"],
    ["text labelled image/png", Buffer.from("this is not an image at all"), "image/png"],
    ["random bytes labelled image/webp", Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) % 256)), "image/webp"],
  ])("reads the bytes, not the label: refuses %s", (_label, buffer, mimeType) => {
    expect(() => validateUploadedFile({ buffer, filename: "r", mimeType, size: buffer.length }, PAYMENT_PROOF_UPLOAD_POLICY)).toThrow(BadRequestError);
  });

  it("refuses an image whose real format is not allowed (a GIF labelled image/png)", () => {
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    expect(() => validateUploadedFile({ buffer: gif, filename: "r.png", mimeType: "image/png", size: gif.length }, PAYMENT_PROOF_UPLOAD_POLICY)).toThrow(/Unsupported image format "gif"/);
  });
});

/** A minimal valid 1x1 PNG — `validateUploadedFile` only reads dimensions for image mimes when width/height limits are configured; neither policy here sets any, so the buffer content is not actually decoded, but a real buffer is used regardless for honesty. */
function pngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
}
