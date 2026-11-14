import { BadRequestError } from "@kira-joo/backend-toolkit-core";
import { ProductModel } from "./product.schema";
import { buildAttributeCatalog, type AttributeCatalogEntry } from "./attribute-catalog";
import { attributeIdentityProblems, type IdentityAttribute } from "./attribute-identity";

/** Every product, any lifecycle (a draft's attributes are as much "existing" as a published one's), projected to its attributes only. */
export async function loadAttributeCatalog(): Promise<AttributeCatalogEntry[]> {
  const rows = await ProductModel.find({ "attributes.0": { $exists: true } }, { attributes: 1 }).lean();
  return buildAttributeCatalog(rows);
}

/** The console's guard: refuses (400) a new attribute whose name an existing attribute already carries. Catalog import applies the same rule per row (`import-attribute-identity.ts`). */
export async function assertAttributeIdentity(attributes: readonly IdentityAttribute[], ownExistingKeys: Iterable<string> = []): Promise<void> {
  if (attributes.length === 0) return;
  const problems = attributeIdentityProblems(attributes, await loadAttributeCatalog(), ownExistingKeys);
  if (problems.length > 0) throw new BadRequestError(problems.join(" "));
}
