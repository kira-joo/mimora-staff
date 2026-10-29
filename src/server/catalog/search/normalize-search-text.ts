/*
 * Arabic-aware search normalisation (plan #8) — pure functions, no database.
 *
 * Arabic text reaches a search box in many spellings of the same word: with or
 * without tashkeel (vowel marks), with tatweel (the elongation stroke), with any
 * of four alef shapes, with ى or ي at the end of a word, with ة or ه. A shopper
 * typing one spelling must find a product written in another.
 *
 * There are two halves and they are deliberately symmetric:
 *
 *  - `normalizeSearchText` is the canonical form: marks removed, alef forms
 *    unified (أ إ آ ٱ → ا), ى → ي, ة → ه, Arabic-Indic digits → Latin digits,
 *    case folded, whitespace collapsed. A text matches a query when the
 *    normalised text contains the normalised query.
 *
 *  - `buildSearchPattern` compiles ONE normalised token into a regular
 *    expression that answers the same question against the RAW stored text, by
 *    accepting every spelling of each letter and any run of marks between
 *    letters. That is what lets the database do the matching without a
 *    precomputed normalised copy of every product name — a copy that would go
 *    stale the moment a name or description were edited, and that the product
 *    update path does not refresh. The property test in
 *    `normalize-search-text.test.ts` asserts the two halves agree.
 *
 * Every literal character is regex-escaped.
 */

/**
 * Tashkeel (064B-065F), superscript alef (0670), tatweel (0640) and Quranic annotation marks (06D6-06ED).
 *
 * The characters are written into the class LITERALLY (these are JS escapes in a string, not regex escapes):
 * the pattern is sent to MongoDB, whose PCRE2 engine rejects `\uXXXX` ("PCRE2 does not support \F, \L, \l,
 * \N{name}, \U, or \u"), though it accepts the characters themselves.
 */
const MARKS_CLASS = "[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]";
const MARKS = new RegExp(MARKS_CLASS, "g");

const ALEF_FORMS = "اأإآٱ";
const YEH_FORMS = "يى";
const HEH_FORMS = "هة";

/** Letter → every spelling the database should accept for it, keyed by the NORMALISED letter. */
const EQUIVALENTS: Record<string, string> = {
  "ا": ALEF_FORMS,
  "ي": YEH_FORMS,
  "ه": HEH_FORMS,
  ...Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [String(digit), `${digit}${String.fromCharCode(0x0660 + digit)}${String.fromCharCode(0x06f0 + digit)}`])),
};

/** A bounded search: more terms or longer terms than this are not a human query. */
export const MAX_SEARCH_TOKENS = 8;
export const MAX_SEARCH_TOKEN_LENGTH = 100;

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\\/-]/g;
const escapeRegex = (value: string) => value.replace(REGEX_SPECIALS, "\\$&");

function foldCharacter(character: string): string {
  if (ALEF_FORMS.includes(character)) return "ا";
  if (character === "ى") return "ي";
  if (character === "ة") return "ه";
  const code = character.charCodeAt(0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  return character;
}

/** The canonical form of a text for comparison — see the file comment. */
export function normalizeSearchText(input: string): string {
  return Array.from(input.normalize("NFKC").replace(MARKS, "").toLowerCase(), foldCharacter).join("").replace(/\s+/g, " ").trim();
}

/** The normalised, bounded, whitespace-split terms of a search box. A product must match every term. */
export function searchTokens(input: string | undefined): string[] {
  if (!input) return [];
  return normalizeSearchText(input)
    .split(" ")
    .filter((token) => token.length > 0)
    .slice(0, MAX_SEARCH_TOKENS)
    .map((token) => token.slice(0, MAX_SEARCH_TOKEN_LENGTH));
}

/**
 * The source of a case-insensitive regular expression matching `token` (no
 * whitespace; letters are folded again, so a raw token is safe) in raw text. Compile with the `i` flag.
 */
export function buildSearchPattern(token: string): string {
  return Array.from(token, foldCharacter)
    .map((character) => {
      const spellings = EQUIVALENTS[character];
      return spellings ? `[${spellings}]` : escapeRegex(character);
    })
    .join(`${MARKS_CLASS}*`);
}

/** Convenience: the compiled, case-insensitive expression for one token. */
export function searchRegex(token: string): RegExp {
  return new RegExp(buildSearchPattern(token), "i");
}
