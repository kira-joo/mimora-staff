import { SortOrder } from "@kira-joo/toolkit-common";
import { assetProvider } from "../../core/assets/asset-providers";
import { pendingUploadRepository } from "../../core/repositories";
import { isImageReferenced } from "./image-cleanup";
import { isManagedAsset } from "./media-targets";

/** An upload younger than this is left alone: its record may simply not have been saved yet. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
/** Rows examined per run, oldest first. A backlog drains over successive daily runs; one run stays inside a function's time budget. */
export const SWEEP_BATCH_SIZE = 200;

export interface SweepOrphanImagesResult {
  /** Rows older than the grace period that this run looked at. */
  examined: number;
  /** Referenced by a document: alive, no longer pending. */
  kept: number;
  /** Unreferenced and destroyed. */
  destroyed: string[];
  /** Destroy raised; the row stays and the next run retries. */
  failed: string[];
}

/**
 * Destroys public images that were uploaded and never saved on any record.
 *
 * Works from `PendingUpload` (written at upload time) because the provider cannot list its assets. For each upload
 * older than {@link ORPHAN_GRACE_MS}: referenced by a document → keep the asset, drop the row; unreferenced → destroy
 * the asset, then drop the row. Younger uploads are not touched at all.
 *
 * - **Only this application's namespace is ever destroyed** (`isManagedAsset`); a row outside it is dropped unactioned.
 * - **Idempotent and re-runnable.** A row goes only after its asset is destroyed or found referenced, so a crash or a
 *   provider error leaves it for the next run; `destroyAsset` resolves for an already-gone asset.
 * - **No transaction, deliberately:** destroying is external I/O, which must not sit inside one. The reference check
 *   and the destroy are separate steps, so an asset saved in the instant between them could be lost — the 24-hour
 *   grace is what makes that window one a person cannot reach (an upload still unsaved after a day is abandoned).
 * - One asset's failure does not stop the next.
 */
export async function sweepOrphanImages(now: Date, options: { graceMs?: number; batchSize?: number } = {}): Promise<SweepOrphanImagesResult> {
  const cutoff = new Date(now.getTime() - (options.graceMs ?? ORPHAN_GRACE_MS));
  const stale = await pendingUploadRepository.findAll({
    where: { createdAt: { $lt: cutoff } },
    sort: { field: "createdAt", order: SortOrder.ASC },
    take: options.batchSize ?? SWEEP_BATCH_SIZE,
    lean: true,
  });

  const result: SweepOrphanImagesResult = { examined: stale.length, kept: 0, destroyed: [], failed: [] };

  for (const row of stale) {
    const { publicId } = row;
    try {
      if (!isManagedAsset(publicId)) {
        await pendingUploadRepository.delete({ where: { _id: row._id } });
        continue;
      }
      if (await isImageReferenced(publicId)) {
        result.kept += 1;
      } else {
        await assetProvider().destroyAsset(publicId, "image");
        result.destroyed.push(publicId);
      }
      await pendingUploadRepository.delete({ where: { _id: row._id } });
    } catch (error) {
      result.failed.push(publicId);
      console.error(`[media] Orphan sweep could not process ${publicId}; it stays pending and is retried on the next run.`, error);
    }
  }

  return result;
}
