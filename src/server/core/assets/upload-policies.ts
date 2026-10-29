import type { UploadPolicy } from "@kira-joo/toolkit-common";

/**
 * Upload policies — new in Phase 4A.5, one object per upload surface, fed
 * to both `validateUploadedFile` (server) and, later, the client-side
 * pre-check (`@kira-joo/frontend-toolkit-tailwind`) — never two separately
 * hand-maintained sets of limits for the same field, per that shared
 * interface's own contract.
 */

/** Catalog imagery — product, variant, category, brand, collection. */
export const CATALOG_IMAGE_UPLOAD_POLICY: UploadPolicy = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  allowedFormats: ["jpg", "jpeg", "png", "webp"],
  maxBytes: 8 * 1024 * 1024,
  minWidth: 200,
  minHeight: 200,
  // A ceiling on the decoded size too: a 60000x60000 PNG is a few KB on the wire and gigabytes in a browser.
  maxWidth: 8000,
  maxHeight: 8000,
};

/**
 * Store identity imagery — logo, social/OG image, hero. PUBLIC and permanent, like catalog imagery, but a
 * logo is legitimately small and an OG image is wide, so the floor is lower and no aspect is imposed
 * (cropping is the storefront's job, not a refusal here).
 */
export const BRAND_IMAGE_UPLOAD_POLICY: UploadPolicy = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  allowedFormats: ["jpg", "jpeg", "png", "webp"],
  maxBytes: 5 * 1024 * 1024,
  minWidth: 64,
  minHeight: 64,
  maxWidth: 8000,
  maxHeight: 8000,
};

/** The favicon: small by nature, and a megabyte of icon is a mistake worth refusing. */
export const FAVICON_UPLOAD_POLICY: UploadPolicy = {
  allowedMimeTypes: ["image/png", "image/webp", "image/jpeg"],
  allowedFormats: ["png", "webp", "jpg", "jpeg"],
  maxBytes: 1024 * 1024,
  minWidth: 32,
  minHeight: 32,
  maxWidth: 1024,
  maxHeight: 1024,
};

/**
 * Payment-proof screenshots — a photographed or screenshotted receipt.
 * Includes HEIC (common on iOS camera uploads without an explicit export
 * step) alongside the standard web formats; no minimum dimensions — a
 * legitimate receipt screenshot can be small.
 */
export const PAYMENT_PROOF_UPLOAD_POLICY: UploadPolicy = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  // "heif": image-size reports a HEIF-branded (mif1) iOS/Android photo as heif, an iPhone HEIC as heic.
  allowedFormats: ["jpg", "jpeg", "png", "webp", "heic", "heif"],
  maxBytes: 8 * 1024 * 1024,
  /*
   * 1 px rejects no real image — it exists to make the toolkit READ the file. `validateUploadedFile`
   * only decodes the bytes (and checks `allowedFormats` against what they really are) when a
   * dimension limit is set; without one the declared mime type was trusted, so PDF or arbitrary
   * bytes labelled image/jpeg passed the server's own validation (measured 2026-10-22).
   */
  minWidth: 1,
  minHeight: 1,
};

/** Seconds a minted payment-proof retrieval URL stays valid — short enough that a leaked link (a forwarded screenshot, a browser history entry) is worthless soon after. */
export const PAYMENT_PROOF_SIGNED_URL_TTL_SECONDS = 5 * 60;
