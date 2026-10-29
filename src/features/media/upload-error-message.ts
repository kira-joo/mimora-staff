import { isApiError } from "@kira-joo/frontend-toolkit-core";

/**
 * What to tell staff about a failed image upload — the server's own words where it has them (storage not configured,
 * a dimension or format refusal), `fallback` otherwise.
 *
 * `useEndpointUpload` rethrows the toolkit's plain `ApiError` object, which is not an `Error`, so an
 * `instanceof Error` check misses every server refusal and shows the generic line instead.
 */
export function uploadErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) || error instanceof Error) {
    const message = typeof error.message === "string" ? error.message.trim() : "";
    if (message) return message;
  }
  return fallback;
}
