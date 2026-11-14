/**
 * Name similarity for product attributes and their values. Pure and import-free so the console's editor (client) and
 * the server guard share ONE definition of "the same thing, spelled differently".
 *
 * Exact is a blocking verdict (the two normalise to the same name); near is a warning a person may overrule.
 */

export interface SimilarityCandidate {
  key: string;
  en: string;
  ar: string;
}

/** Anything that carries an identity key and an English + Arabic name — a catalog attribute, or (via `valueAsNamed`) a value. */
export interface NamedEntry {
  key: string;
  name: { en: string; ar: string };
}

export interface SimilarityResult<T> {
  /** Same normalised en, ar or key. Blocks creating a duplicate. */
  exact: T[];
  /** Close but not the same (typo, plural, Arabic broken plural). A warning only. */
  near: T[];
}

const ARABIC_DIACRITICS = /[ً-ٰٟـ]/g; // harakat, dagger alef, tatweel
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]/gu;

/**
 * A comparison form of a name: trimmed, lower-cased, Arabic diacritics and tatweel gone, alef/ya/ta-marbuta variants
 * unified (أإآ→ا, ى→ي, ة→ه), the Arabic article "ال" and an English plural ending (es/s, when longer than 3) removed,
 * and everything that is not a letter or digit dropped. So "Colors" = "Color" and "اللون" = "لون".
 */
export function normalizeAttributeName(input: string): string {
  let text = input
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(NOT_LETTER_OR_DIGIT, "");
  if (text.startsWith("ال") && text.length > 2) text = text.slice(2);
  if (text.length > 3) {
    if (text.endsWith("es")) text = text.slice(0, -2);
    else if (text.endsWith("s")) text = text.slice(0, -1);
  }
  return text;
}

const HAS_ARABIC = /[؀-ۿ]/;

/**
 * Arabic broken plurals insert an alef ("لون" → "ألوان"), which no edit-distance threshold on short words catches.
 * Dropping every alef gives a skeleton on which they coincide. Only used to flag NEAR, and only for Arabic text.
 */
function arabicSkeleton(normalized: string): string {
  return HAS_ARABIC.test(normalized) ? normalized.replace(/ا/g, "") : "";
}

export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

interface Forms {
  normalized: string[];
  skeletons: string[];
}

function formsOf(name: SimilarityCandidate): Forms {
  const normalized = [name.en, name.ar, name.key].map(normalizeAttributeName).filter((form) => form.length > 0);
  return { normalized, skeletons: normalized.map(arabicSkeleton).filter((form) => form.length > 0) };
}

/** ≤1 edit for names up to 4 characters, ≤2 beyond — judged on the shorter of the pair. */
function nearEnough(a: string, b: string): boolean {
  const threshold = Math.min(a.length, b.length) <= 4 ? 1 : 2;
  return levenshtein(a, b, threshold) <= threshold;
}

/** Compares the candidate against entries carrying `{ key, name: { en, ar } }`. */
export function findSimilar<T extends NamedEntry>(candidate: SimilarityCandidate, entries: readonly T[]): SimilarityResult<T> {
  const mine = formsOf(candidate);
  const exact: T[] = [];
  const near: T[] = [];
  if (mine.normalized.length === 0) return { exact, near };

  for (const entry of entries) {
    const theirs = formsOf({ key: entry.key, en: entry.name.en, ar: entry.name.ar });
    if (mine.normalized.some((form) => theirs.normalized.includes(form))) {
      exact.push(entry);
      continue;
    }
    const isNear =
      mine.normalized.some((a) => theirs.normalized.some((b) => nearEnough(a, b))) || mine.skeletons.some((a) => theirs.skeletons.includes(a));
    if (isNear) near.push(entry);
  }
  return { exact, near };
}

/** Adapts an attribute value (`{ key, value }`) to the shape `findSimilar` compares. */
export const valueAsNamed = (entry: { key: string; value: { en: string; ar: string } }): NamedEntry & { value: { en: string; ar: string } } => ({
  ...entry,
  name: entry.value,
});

/** `findSimilar` over one attribute's values. */
export function findSimilarValues<T extends { key: string; value: { en: string; ar: string } }>(candidate: SimilarityCandidate, values: readonly T[]): SimilarityResult<T> {
  const result = findSimilar(candidate, values.map(valueAsNamed));
  const byKey = new Map(values.map((entry) => [entry.key, entry]));
  return { exact: result.exact.map((entry) => byKey.get(entry.key)!), near: result.near.map((entry) => byKey.get(entry.key)!) };
}

/**
 * The attribute picker's search: everything whose name (in either language, any recorded variant) or key contains the
 * search text, then — so a different spelling still FINDS the attribute that already exists — the exact-normalized and
 * near matches `findSimilar` reports ("colour" finds Color, "الألوان" finds اللون). Each entry once, direct hits first.
 */
export function searchAttributes<T extends NamedEntry & { nameVariants?: ReadonlyArray<{ en: string; ar: string }> }>(entries: readonly T[], search: string): T[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return [...entries];
  const normalized = normalizeAttributeName(search);
  const direct = entries.filter(
    (entry) =>
      entry.key.toLowerCase().includes(needle) ||
      [entry.name, ...(entry.nameVariants ?? [])].some(
        (name) => [name.en, name.ar].some((text) => text.toLowerCase().includes(needle)) || (normalized.length > 0 && [normalizeAttributeName(name.en), normalizeAttributeName(name.ar)].some((text) => text.includes(normalized)))
      )
  );
  const similar = findSimilar({ key: "", en: search, ar: search }, entries);
  const seen = new Set(direct);
  return [...direct, ...[...similar.exact, ...similar.near].filter((entry) => !seen.has(entry))];
}
