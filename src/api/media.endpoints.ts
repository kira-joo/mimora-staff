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
