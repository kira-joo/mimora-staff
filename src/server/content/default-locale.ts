import { ValidationFailedError, type ValidationFieldError } from "@kira-joo/backend-toolkit-core";
import type { LocalizedLocale, LocalizedString } from "@kira-joo/toolkit-common";
import { storeProfileRepository } from "../core/repositories";

/**
 * D-11 — "block publish unless the default locale is complete; warn but
 * allow for the secondary" (docs/store/03-decisions-and-assumptions.md).
 *
 * The toolkit's `findIncompleteLocalizedPaths` asks for **both** locales,
 * which is stricter than D-11 and would refuse a store that publishes in
 * Arabic first and translates later. This walks the same `{ar, en}` shapes
 * but judges only the store's default locale:
 *
 * - a **required** field must have the default locale filled;
 * - an **optional** field may be blank in both, but not filled only in the
 *   secondary locale — that is exactly "a product with only English
 *   content", shown to an Arabic-default customer as a gap.
 *
 * `[TOOLKIT CANDIDATE]` a locale-parameterised variant belongs beside
 * `findIncompleteLocalizedPaths` in `@kira-joo/toolkit-common`; kept here
 * until a release of that package is asked for.
 */
export function findMissingDefaultLocalePaths(value: unknown, locale: LocalizedLocale, isRequired: (path: string) => boolean = () => true): string[] {
  const other: LocalizedLocale = locale === "ar" ? "en" : "ar";
  return walk(value, "");

  function walk(node: unknown, path: string): string[] {
    if (node === undefined || node === null) return [];
    if (isLocalizedShape(node)) {
      if (node[locale].trim() !== "") return [];
      if (isRequired(path) || node[other].trim() !== "") return [path];
      return [];
    }
    if (Array.isArray(node)) return node.flatMap((item, index) => walk(item, path ? `${path}.${index}` : `${index}`));
    if (typeof node === "object" && Object.getPrototypeOf(node) === Object.prototype) {
      return Object.entries(node as Record<string, unknown>).flatMap(([key, entry]) => walk(entry, path ? `${path}.${key}` : key));
    }
    return [];
  }
}

function isLocalizedShape(value: unknown): value is LocalizedString {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.ar === "string" && typeof candidate.en === "string";
}

const LOCALE_NAMES: Record<LocalizedLocale, string> = { ar: "Arabic", en: "English" };

/** The store's default locale (`StoreProfile.defaultLocale`, `ar` until a profile says otherwise). */
export async function getStoreDefaultLocale(): Promise<LocalizedLocale> {
  const profile = await storeProfileRepository.findOne({ where: {}, select: { defaultLocale: true }, skipThrowError: true, lean: true });
  return (profile?.defaultLocale as LocalizedLocale | undefined) ?? "ar";
}

/** The D-11 problems in `value`, one per field, without throwing — for a preview that lists what would block publishing. */
export async function defaultLocaleProblems(value: unknown, isRequired: (path: string) => boolean): Promise<ValidationFieldError[]> {
  const locale = await getStoreDefaultLocale();
  const message = `${LOCALE_NAMES[locale]} is this store's default language — fill it in before publishing.`;
  return findMissingDefaultLocalePaths(value, locale, isRequired).map((field) => ({ field, messages: [message] }));
}

/**
 * Refuses publication with a field-mapped 400 when the default locale is
 * missing anywhere it is needed — each path is the form field to fix.
 */
export async function assertDefaultLocaleComplete(value: unknown, isRequired: (path: string) => boolean): Promise<void> {
  const problems = await defaultLocaleProblems(value, isRequired);
  if (problems.length > 0) throw new ValidationFailedError(problems);
}
