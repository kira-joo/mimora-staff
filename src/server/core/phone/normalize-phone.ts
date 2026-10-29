/**
 * Phone canonicalisation — pure, no I/O, no environment. The deployment's
 * default country calling code is an argument, so every rule is testable.
 *
 * Rules, in order:
 *  1. Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (U+06F0-06F9) digits become Latin digits.
 *  2. Spaces, dashes, dots, parentheses, slashes and bidi/format marks are stripped.
 *  3. A leading `00` becomes `+`.
 *  4. A leading `+` is kept; the rest must be 8-15 digits to count as E.164.
 *  5. A national number with a leading trunk `0`, WITH a configured country code, becomes
 *     `+<cc><number without the trunk 0>`.
 *  6. Anything else is returned as the cleaned digit string — a country is never guessed.
 *
 * Garbage (letters, stray symbols) is returned cleaned-but-unchanged; rejecting
 * it is the validation layer's job (`isValidCanonicalPhone`).
 */

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= EXTENDED_ARABIC_INDIC_ZERO ? code - EXTENDED_ARABIC_INDIC_ZERO : code - ARABIC_INDIC_ZERO);
  });
}

/** Digits mapped and separators stripped, nothing else interpreted. */
export function cleanPhone(raw: string): string {
  return toLatinDigits(raw).replace(/[\s\-.()/ ​-‏‪-‮⁦-⁩﻿]/g, "");
}

/** `digits` is the E.164 body, 8-15 digits, no leading zero. */
const E164 = /^\+[1-9]\d{7,14}$/;
const NATIONAL = /^\d{5,15}$/;

export function isValidCanonicalPhone(value: string): boolean {
  return E164.test(value) || NATIONAL.test(value);
}

/** A default calling code is digits only, 1-3 long, no leading zero. */
export function isValidCountryCallingCode(cc: string): boolean {
  return /^[1-9]\d{0,2}$/.test(cc);
}

export function normalizePhone(raw: string, defaultCountryCode?: string): string {
  let value = cleanPhone(raw);
  if (value.startsWith("00") && !value.startsWith("+")) value = `+${value.slice(2)}`;
  if (value.startsWith("+")) return value;
  const cc = defaultCountryCode && isValidCountryCallingCode(defaultCountryCode) ? defaultCountryCode : undefined;
  if (cc && /^0\d+$/.test(value) && value.length > 1) {
    const candidate = `+${cc}${value.slice(1)}`;
    // Only convert when the result is a well-formed E.164 number; otherwise leave it for validation to judge.
    if (E164.test(candidate)) return candidate;
  }
  return value;
}

/**
 * Every form an EXISTING record for this number might be stored in, derivable from the input.
 * Canonical first. Used for lookups only (login, forgot-password, duplicate checks) so a
 * customer registered before normalisation existed is not locked out; new records are
 * always written canonical.
 */
export function phoneLookupVariants(raw: string, defaultCountryCode?: string): string[] {
  const canonical = normalizePhone(raw, defaultCountryCode);
  const variants = new Set<string>([canonical, cleanPhone(raw), raw.trim()]);
  if (canonical.startsWith("+")) {
    const body = canonical.slice(1);
    variants.add(body); // 201012345678
    variants.add(`00${body}`); // 00201012345678
    if (defaultCountryCode && isValidCountryCallingCode(defaultCountryCode) && body.startsWith(defaultCountryCode)) {
      variants.add(`0${body.slice(defaultCountryCode.length)}`); // 01012345678
    }
  }
  return [...variants].filter((v) => v.length > 0);
}
