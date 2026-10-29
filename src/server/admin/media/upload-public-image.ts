import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { parseMultipartFormData, validateUploadedFile } from "@kira-joo/backend-toolkit-next";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { assetProvider } from "../../core/assets/asset-providers";
import { pendingUploadRepository } from "../../core/repositories";
import type { MediaSpec } from "./media-targets";

/** The multipart field a client submits the image under. */
export const IMAGE_FIELD = "file";

/**
 * Reads ONE image from a multipart request, validates it against the policy (type, size, then the
 * dimensions read from the real bytes), and uploads it as a PUBLIC asset.
 *
 * Validation runs before the provider is touched, so a bad file is a 400 even where storage is not
 * configured, and a good file against unconfigured storage is a 503 from `assetProvider()` — never a
 * partial write, since nothing here touches the database. The asset becomes a record only when the
 * caller then saves it on an entity; an upload nobody saves is an orphan — the known cost of
 * upload-first, as opposed to upload-on-submit, which cannot carry a gallery of several images.
 * Each upload is therefore recorded as a `PendingUpload`, which the daily `sweep-orphan-images` job works from.
 */
export async function uploadPublicImage(request: Request, resolveSpec: (fields: Record<string, string>) => MediaSpec): Promise<ImageAsset> {
  const { files, fields } = await parseMultipartFormData(request);
  const file = files[IMAGE_FIELD];
  if (!file) throw new BadRequestError(`This route requires a "${IMAGE_FIELD}" file field.`);

  const spec = resolveSpec(fields);
  validateUploadedFile(file, spec.policy);

  const asset = await assetProvider().uploadImage(file.buffer, { folder: spec.folder });
  await recordPendingUpload(asset.publicId);
  return asset;
}

/**
 * Remembers the upload so the sweep can find it if nobody saves it. A failure to record is logged loudly but does not
 * fail the request: the file is already in storage and the user's upload succeeded, and failing now would orphan it
 * for certain, where not recording it only means this one file is never swept.
 */
async function recordPendingUpload(publicId: string): Promise<void> {
  try {
    await pendingUploadRepository.save({ publicId });
  } catch (error) {
    console.error(`[media] Uploaded ${publicId} but could not record it for the orphan sweep; it will not be swept if it is never saved.`, error);
  }
}
