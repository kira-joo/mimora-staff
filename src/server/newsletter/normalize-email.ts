/** The one canonical form of an email address for matching and storing: trimmed and lower-cased. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
