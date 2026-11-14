import type { AttributeCatalogEntry } from "./attribute-catalog";
import { normalizeAttributeName } from "./attribute-similarity";

export interface IdentityAttribute {
  key: string;
  name: { en: string; ar: string };
}

/**
 * The advisory invariant behind the editor's picker: a NEW attribute (a key no product uses yet) may not take a name an
 * existing attribute already has under a different key — that is how "Color" and "Colour" end up as two storefront
 * filters. Existing keys always pass (nothing already saved is ever refused), and so does a genuinely new name.
 * Only EXACT (normalised) name equality blocks; near matches are the editor's warning, never a server refusal.
 *
 * `ownExistingKeys` are keys already on the product being saved; they are exempt even if the catalog were somehow stale.
 */
export function attributeIdentityProblems(productAttributes: readonly IdentityAttribute[], catalog: readonly AttributeCatalogEntry[], ownExistingKeys: Iterable<string> = []): string[] {
  const known = new Set<string>([...catalog.map((entry) => entry.key), ...ownExistingKeys]);
  const problems: string[] = [];

  // New attributes in this same save are checked against each other too: two new keys with one name would split one
  // filter into two just as surely as a clash with the catalog would.
  const claimedInThisSave = new Map<string, string>();

  for (const attribute of productAttributes) {
    if (known.has(attribute.key)) continue;
    const mine = [attribute.name.en, attribute.name.ar].map((label) => ({ label, form: normalizeAttributeName(label) })).filter((entry) => entry.form.length > 0);
    const twin = mine.find((candidate) => claimedInThisSave.has(candidate.form) && claimedInThisSave.get(candidate.form) !== attribute.key);
    if (twin) {
      problems.push(`Two new attributes are both named "${twin.label.trim()}" (keys "${claimedInThisSave.get(twin.form)}" and "${attribute.key}") — keep one.`);
      continue;
    }
    for (const candidate of mine) claimedInThisSave.set(candidate.form, attribute.key);
    for (const entry of catalog) {
      const theirs = new Set(entry.nameVariants.flatMap((variant) => [normalizeAttributeName(variant.en), normalizeAttributeName(variant.ar)]));
      const clash = mine.find((candidate) => theirs.has(candidate.form));
      if (clash) {
        problems.push(`An attribute named "${clash.label.trim()}" already exists (key "${entry.key}") — select it instead.`);
        break;
      }
    }
  }
  return problems;
}
