import type { CleanUpUnusedImagesResult } from "src/api/media.endpoints";

/** The four counts the bulk import page shows after "Clean up unused images", in display order. */
export function cleanUpCounts(result: CleanUpUnusedImagesResult): Array<{ label: "Checked" | "Kept" | "Deleted" | "Failed"; value: number }> {
  return [
    { label: "Checked", value: result.examined },
    { label: "Kept", value: result.kept },
    { label: "Deleted", value: result.destroyed.length },
    { label: "Failed", value: result.failed.length },
  ];
}

/** What to tell staff after a run. A failure is a warning: those images stay pending and the next run retries them. */
export function cleanUpSummary(result: CleanUpUnusedImagesResult): { tone: "success" | "warning"; message: string } {
  if (result.examined === 0) return { tone: "success", message: "No uploads older than 24 hours were waiting to be checked." };
  const deleted = result.destroyed.length;
  const base = deleted === 0 ? "No unused images were found." : `Deleted ${deleted} unused image${deleted === 1 ? "" : "s"}.`;
  const failed = result.failed.length;
  if (failed > 0) return { tone: "warning", message: `${base} ${failed} could not be deleted — run it again to retry.` };
  return { tone: "success", message: base };
}
