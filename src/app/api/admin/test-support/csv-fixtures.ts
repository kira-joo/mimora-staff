/** A multipart body carrying one CSV file as `file`. Encodes as UTF-8, as a browser would. */
export function csvForm(content: string | Uint8Array, filename = "catalog.csv", mimeType = "text/csv"): FormData {
  const form = new FormData();
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  form.append("file", new File([new Uint8Array(bytes)], filename, { type: mimeType }));
  return form;
}
