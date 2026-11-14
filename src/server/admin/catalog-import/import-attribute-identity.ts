import type { AttributeCatalogEntry } from "../../catalog/attribute-catalog";
import { attributeIdentityProblems } from "../../catalog/attribute-identity";
import type { ImportIssue } from "./import-types";
import type { PlannedProduct } from "./plan-catalog-import";

/**
 * Catalog import follows the same rule as the console's product form (`attributeIdentityProblems`): a NEW attribute
 * key may not take a name an existing attribute already has. Applied across the whole file in row order — an
 * attribute a row introduces counts as existing for every later row, so two rows cannot split one attribute into two
 * keys either. An attribute a product already carries always passes. Returns one error per offending product.
 */
export function importAttributeIdentityErrors(planned: readonly PlannedProduct[], catalog: readonly AttributeCatalogEntry[]): ImportIssue[] {
  const known: AttributeCatalogEntry[] = [...catalog];
  const errors: ImportIssue[] = [];
  for (const product of planned) {
    const ownKeys = (product.existing?.attributes ?? []).map((attribute) => attribute.key);
    const attributes = product.attributes.map((attribute) => ({ key: attribute.key, name: { en: attribute.name.en ?? "", ar: attribute.name.ar ?? "" } }));
    const problems = attributeIdentityProblems(attributes, known, ownKeys);
    for (const message of problems) errors.push({ row: product.row.line, slug: product.row.slug, column: "attributes", message });
    if (problems.length > 0) continue;
    for (const attribute of attributes) {
      if (known.some((entry) => entry.key === attribute.key)) continue;
      known.push({ key: attribute.key, name: attribute.name, nameVariants: [attribute.name], productCount: 1, values: [] });
    }
  }
  return errors;
}
