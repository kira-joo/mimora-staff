import { MongoField, MongoSchema, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * One public image that was uploaded to the asset provider, recorded at upload time.
 *
 * Uploads happen BEFORE the record that will show them is saved (a gallery of several images cannot upload on
 * submit), so an upload nobody saves is an orphan asset. The provider contract (`AssetProvider`) has upload and
 * destroy but no list call, so the provider cannot be asked "what do you hold that nothing references?". This
 * collection is the answer instead: every upload leaves a row, and `sweepOrphanImages` — a daily job — destroys the
 * rows that are older than a day and that no document references.
 *
 * A row is removed when the sweep finds the asset referenced (it is then a live asset, and `destroyUnreferencedImages`
 * owns its later removal) or after it destroys the asset. Nothing on the save paths touches this collection, so a save
 * path that forgets it cannot cause a referenced asset to be destroyed: the sweep checks references itself.
 *
 * `createdAt` (timestamps) is the upload time.
 */
@MongoSchema({ timestamps: true })
export class PendingUploadSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true })
  publicId!: string;
}

export const PendingUploadModel = createMongoModel("PendingUpload", PendingUploadSchema);
