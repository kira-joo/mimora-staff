import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import { collectionRepository } from "../../core/repositories";
import type { CollectionSchema } from "../../catalog/collection.schema";
import { destroyImagesOnCommit, removedPublicIds } from "../media/image-cleanup";

export interface UpdateCollectionInput {
  name?: LocalizedString;
  description?: LocalizedString;
  slug?: string;
  sortOrder?: number;
  /** `null` removes the image (and destroys the stored asset once the write commits); `undefined` leaves it untouched. */
  image?: ImageAsset | null;
  seoTitle?: LocalizedString;
  seoDescription?: LocalizedString;
  published?: boolean;
}

export async function updateCollection(collectionId: string, input: UpdateCollectionInput): Promise<CollectionSchema> {
  const collection = await collectionRepository.findOne({ where: { _id: collectionId } });

  if (input.slug && input.slug !== collection.slug) {
    const existing = await collectionRepository.findOne({
      where: { slug: input.slug, _id: { $ne: collectionId } },
      skipThrowError: true,
    });
    if (existing) {
      throw new ConflictError("Collection slug already exists");
    }
  }

  const patch: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.image !== undefined) {
    if (input.image === null) unset.image = "";
    else patch.image = input.image;
  }
  if (input.seoTitle !== undefined) patch.seoTitle = input.seoTitle;
  if (input.seoDescription !== undefined) patch.seoDescription = input.seoDescription;
  if (input.published !== undefined) patch.published = input.published;

  // A transaction so the replaced image is destroyed only once this write has committed (`onCommit`).
  return withTransaction(async (tx) => {
    const updated = await collectionRepository.updateAtomic(
      { _id: collectionId },
      { $set: patch, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) }
    );
    destroyImagesOnCommit(tx, removedPublicIds(collection.image, input.image));
    return tx.complete(updated);
  });
}
