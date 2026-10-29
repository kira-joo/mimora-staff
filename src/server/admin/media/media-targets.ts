import type { UploadPolicy } from "@kira-joo/toolkit-common";
import { BRAND_IMAGE_UPLOAD_POLICY, CATALOG_IMAGE_UPLOAD_POLICY, FAVICON_UPLOAD_POLICY } from "../../core/assets/upload-policies";

/**
 * Where PUBLIC catalog and brand imagery lives, and the policy each kind of image is held to.
 *
 * One Cloudinary account serves more than one application, so every folder is namespaced under
 * `MEDIA_ROOT`. That prefix is also what makes cleanup safe: the console sends back asset records it was
 * given, and a record naming a publicId outside this namespace is never destroyed (see
 * `destroyUnreferencedImages`).
 *
 * This module is imported by the console as well (the same policy object drives the client pre-check and
 * the server check, never two hand-kept sets of numbers), so it carries no server-only import.
 */
export const MEDIA_ROOT = "store";

/** One gallery, not a media library; also bounds what a single save can orphan. Shared by the DTO and the product image manager. */
export const MAX_PRODUCT_IMAGES = 20;

export const MEDIA_TARGETS = ["product", "category", "collection", "store-profile"] as const;
export type MediaTarget = (typeof MEDIA_TARGETS)[number];

/** The store-profile slots that hold one image each. `ogImage` is the one the storefront reads (not `defaultSeo.ogImage`). */
export const STORE_PROFILE_SLOTS = ["logo", "favicon", "ogImage", "heroMedia"] as const;
export type StoreProfileSlot = (typeof STORE_PROFILE_SLOTS)[number];

export interface MediaSpec {
  folder: string;
  policy: UploadPolicy;
}

const CATALOG_FOLDERS = {
  product: `${MEDIA_ROOT}/products`,
  category: `${MEDIA_ROOT}/categories`,
  collection: `${MEDIA_ROOT}/collections`,
} as const;

const STORE_PROFILE_FOLDER = `${MEDIA_ROOT}/store-profile`;

const STORE_PROFILE_POLICIES: Record<StoreProfileSlot, UploadPolicy> = {
  logo: BRAND_IMAGE_UPLOAD_POLICY,
  favicon: FAVICON_UPLOAD_POLICY,
  ogImage: BRAND_IMAGE_UPLOAD_POLICY,
  heroMedia: BRAND_IMAGE_UPLOAD_POLICY,
};

export function catalogMediaSpec(target: keyof typeof CATALOG_FOLDERS): MediaSpec {
  return { folder: CATALOG_FOLDERS[target], policy: CATALOG_IMAGE_UPLOAD_POLICY };
}

export function storeProfileMediaSpec(slot: StoreProfileSlot): MediaSpec {
  return { folder: STORE_PROFILE_FOLDER, policy: STORE_PROFILE_POLICIES[slot] };
}

export function isStoreProfileSlot(value: unknown): value is StoreProfileSlot {
  return typeof value === "string" && (STORE_PROFILE_SLOTS as readonly string[]).includes(value);
}

/** Whether a stored asset is one this application's uploads could have produced — the only kind it ever destroys. */
export function isManagedAsset(publicId: string | undefined): publicId is string {
  return typeof publicId === "string" && publicId.startsWith(`${MEDIA_ROOT}/`);
}
