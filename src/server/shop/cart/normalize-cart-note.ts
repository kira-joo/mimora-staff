/**
 * A cart line's identity is `(variantId, normalizedNote)` — Phase 4B
 * Batch 3, per the corrected scope. Two lines for the same variant with
 * genuinely different notes are distinct purchases (e.g. one gift-wrapped,
 * one not) and must never merge; two lines that only differ by incidental
 * whitespace must merge into one.
 *
 * `undefined` is the one canonical "no note" representation — an empty or
 * whitespace-only input collapses to it, matching the schema's own
 * optional `note?` field, rather than persisting a distinguishable empty
 * string that would silently fail to merge with an absent note.
 */
export function normalizeCartNote(note: string | undefined | null): string | undefined {
  const trimmed = note?.trim();
  return trimmed ? trimmed : undefined;
}
