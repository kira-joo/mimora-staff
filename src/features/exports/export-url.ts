import { EXPORT_PATHS, type ExportKind } from "src/api/exports.endpoints";

/** Keys the table keeps in the URL that describe the VIEW, not the filter: an export is everything matching, never one page. */
const VIEW_ONLY = new Set(["page", "limit", "sortBy", "sortOrder"]);

/**
 * The export's URL for the list the staff member is looking at: the table's own
 * filters (which live in the page URL) are forwarded, its paging and sorting are not.
 */
export function exportUrl(kind: ExportKind, params: URLSearchParams | string, apiBase = "/api"): string {
  const source = typeof params === "string" ? new URLSearchParams(params) : params;
  const filters = new URLSearchParams();
  for (const [key, value] of source) if (!VIEW_ONLY.has(key) && value !== "") filters.append(key, value);
  const query = filters.toString();
  return `${apiBase}${EXPORT_PATHS[kind]}${query ? `?${query}` : ""}`;
}

/** The file name the server suggested, or a fallback — `Content-Disposition: attachment; filename="x.csv"`. */
export function filenameFrom(disposition: string | null, fallback: string): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}
