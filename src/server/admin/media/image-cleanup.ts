import type { TransactionContext } from "@kira-joo/backend-toolkit-mongoose";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { CategoryModel } from "../../catalog/category.schema";
import { CollectionModel } from "../../catalog/collection.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { PageModel } from "../../content/page.schema";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { assetProvider } from "../../core/assets/asset-providers";
import { isManagedAsset } from "./media-targets";

type ImageRef = Pick<ImageAsset, "publicId"> | null | undefined;

/**
 * The publicIds in `before` that `after` no longer holds. `after` undefined means "this field was not
 * part of the write", which removes nothing; `null`/`[]` means cleared, which removes everything.
 */
export function removedPublicIds(before: ImageRef | readonly ImageRef[], after: ImageRef | readonly ImageRef[] | undefined): string[] {
  if (after === undefined) return [];
  const toIds = (value: ImageRef | readonly ImageRef[]) => (Array.isArray(value) ? value : [value]).map((image) => (image as ImageRef)?.publicId).filter((id): id is string => Boolean(id));
  const kept = new Set(toIds(after));
  return [...new Set(toIds(before))].filter((id) => !kept.has(id));
}

/** Whether any document still points at this asset. The store has one asset per slot, except a variant gallery that picks from its product's images. */
export async function isImageReferenced(publicId: string): Promise<boolean> {
  const checks = await Promise.all([
    ProductModel.exists({ "images.publicId": publicId }),
    VariantModel.exists({ "galleryOverride.publicId": publicId }),
    CategoryModel.exists({ "image.publicId": publicId }),
    CollectionModel.exists({ "image.publicId": publicId }),
    StoreProfileModel.exists({ $or: ["logo", "favicon", "ogImage", "heroMedia", "defaultSeo.ogImage"].map((path) => ({ [`${path}.publicId`]: publicId })) }),
    PageModel.exists({ "seo.ogImage.publicId": publicId }),
  ]);
  return checks.some(Boolean);
}

/**
 * Destroys replaced or removed assets. Meant to run AFTER the database write has committed — a failed
 * write must never have already deleted the picture it was keeping — and therefore never inside the
 * transaction (no external I/O there). A failure here is logged and swallowed: the entity is already
 * saved, and an orphaned file costs less than failing an edit that succeeded.
 *
 * Three guards, each against a different way to delete something that should live:
 *  - only assets under this application's namespace (the console echoes records back, so a forged
 *    publicId must not reach another application's files);
 *  - only when no document still references the asset (a variant gallery may share a product image);
 *  - one asset's failure does not stop the next.
 */
export async function destroyUnreferencedImages(publicIds: readonly string[]): Promise<void> {
  for (const publicId of new Set(publicIds)) {
    if (!isManagedAsset(publicId)) continue;
    try {
      if (await isImageReferenced(publicId)) continue;
      await assetProvider().destroyAsset(publicId, "image");
    } catch (error) {
      console.error(`[media] Could not destroy replaced or removed asset ${publicId}; it is now an orphan.`, error);
    }
  }
}

/** Schedules the cleanup for after the surrounding transaction commits; a rollback or a retried attempt destroys nothing. */
export function destroyImagesOnCommit(tx: Pick<TransactionContext, "onCommit">, publicIds: readonly string[]): void {
  if (publicIds.length === 0) return;
  tx.onCommit(() => destroyUnreferencedImages(publicIds));
}
