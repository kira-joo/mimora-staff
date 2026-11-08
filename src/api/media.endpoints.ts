import { MethodType, type Endpoint } from "@kira-joo/frontend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";

/**
 * Public catalog and brand imagery. Each upload is multipart (field `file`) and answers the stored `ImageAsset`;
 * nothing is saved on a record until the caller sends that asset with the record's own save.
 * One endpoint per target, because each answers to its own permission.
 */
type Upload = Endpoint<{ body: { slot?: string }; returnType: ImageAsset }>;

export const uploadProductImageEndpoint: Upload = { url: "/admin/media/product-images", methodType: MethodType.POST };
export const uploadCategoryImageEndpoint: Upload = { url: "/admin/media/category-images", methodType: MethodType.POST };
export const uploadCollectionImageEndpoint: Upload = { url: "/admin/media/collection-images", methodType: MethodType.POST };
/** Body `slot`: `logo`, `favicon`, `ogImage` or `heroMedia` — picks the policy the file is held to. */
export const uploadStoreProfileImageEndpoint: Upload = { url: "/admin/media/store-profile-images", methodType: MethodType.POST };

/** What one "Clean up unused images" run did (POST /admin/media/sweep-orphans). */
export interface CleanUpUnusedImagesResult {
  /** Pending uploads older than 24 hours that this run looked at (at most one batch). */
  examined: number;
  /** In use by a record: kept. */
  kept: number;
  /** Unused and permanently deleted. */
  destroyed: string[];
  /** Deletion failed; they stay pending and the next run retries them. */
  failed: string[];
}

export const cleanUpUnusedImagesEndpoint: Endpoint<{ returnType: CleanUpUnusedImagesResult }> = { url: "/admin/media/sweep-orphans", methodType: MethodType.POST };
