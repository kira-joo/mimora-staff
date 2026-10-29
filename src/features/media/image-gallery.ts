import type { ImageAsset, UploadPolicy } from "@kira-joo/toolkit-common";

/** Moves one image to a new position (clamped); the first position is the primary image. Pure — returns a new list. */
export function moveImage<T>(images: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= images.length) return [...images];
  const target = Math.max(0, Math.min(images.length - 1, to));
  const next = [...images];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved as T);
  return next;
}

export const removeImageAt = <T>(images: readonly T[], index: number): T[] => images.filter((_, i) => i !== index);

/** Whether two galleries hold the same assets in the same order — what "unsaved changes" means. */
export function sameGallery(a: readonly Pick<ImageAsset, "publicId">[], b: readonly Pick<ImageAsset, "publicId">[]): boolean {
  return a.length === b.length && a.every((image, index) => image.publicId === b[index]?.publicId);
}

/**
 * The browser-side half of the same policy the server enforces (`validateUploadedFile`): the file's type and size,
 * which are known before any upload. Dimensions are only knowable from the bytes, so the server answers for those and
 * its message is shown as-is. Returns the problem, or `undefined`.
 */
export function precheckImage(file: Pick<File, "type" | "size" | "name">, policy: UploadPolicy): string | undefined {
  if (!policy.allowedMimeTypes.includes(file.type)) {
    const allowed = policy.allowedFormats.map((format) => format.toUpperCase()).filter((format, i, all) => format !== "JPEG" || !all.includes("JPG")).join(", ");
    return `"${file.name}" is not a supported image type. Use ${allowed}.`;
  }
  if (file.size > policy.maxBytes) return `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB; the limit is ${(policy.maxBytes / (1024 * 1024)).toFixed(0)} MB.`;
  return undefined;
}

/** The `accept` attribute for a policy's allowed types. */
export const acceptFor = (policy: UploadPolicy): string => policy.allowedMimeTypes.join(",");

/** A policy's dimension limits as one readable line, e.g. "At least 200 × 200 px, at most 8000 × 8000 px." */
export function describeDimensions(policy: UploadPolicy): string | undefined {
  const min = policy.minWidth || policy.minHeight ? `at least ${policy.minWidth ?? 0} × ${policy.minHeight ?? 0} px` : undefined;
  const max = policy.maxWidth || policy.maxHeight ? `at most ${policy.maxWidth ?? "any"} × ${policy.maxHeight ?? "any"} px` : undefined;
  const text = [min, max].filter(Boolean).join(", ");
  return text ? `${text[0]!.toUpperCase()}${text.slice(1)}.` : undefined;
}

/** The variant's chosen images in the product gallery's order, so toggling never reshuffles what customers see. */
export function toggleGalleryPick(gallery: readonly ImageAsset[], selected: readonly Pick<ImageAsset, "publicId">[], image: ImageAsset): ImageAsset[] {
  const chosen = new Set(selected.map((pick) => pick.publicId));
  if (chosen.has(image.publicId)) chosen.delete(image.publicId);
  else chosen.add(image.publicId);
  return gallery.filter((candidate) => chosen.has(candidate.publicId));
}
