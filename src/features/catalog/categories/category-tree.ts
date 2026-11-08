import type { Category } from "src/api/categories.endpoints";

/**
 * The categories directly under `parentId` (`null` = top level), in the
 * storefront's order: `sortOrder`, then name for ties, so an unordered
 * import still lists predictably.
 */
export function siblingsOf(categories: readonly Category[], parentId: string | null): Category[] {
  return categories
    .filter((category) => (category.parentId ?? null) === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.name.en || a.name.ar).localeCompare(b.name.en || b.name.ar));
}

/** The reorder payload: each id's new position, 0-based, in the order given. */
export const reorderItems = (ids: readonly string[]) => ids.map((categoryId, sortOrder) => ({ categoryId, sortOrder }));

/**
 * Every category as a picker option, in tree order (each parent followed by its own sub-categories, in storefront
 * order), labelled with its full path — "Accessories › Jewelry" — so two sub-categories with the same name under
 * different parents stay distinguishable. `excludeSubtreeOf` drops a category and everything beneath it: the choices a
 * parent picker must not offer, since the API refuses a move under oneself. A category whose parent is missing from
 * the list is listed from the top rather than lost.
 */
export function categoryOptions(categories: readonly Category[], options: { excludeSubtreeOf?: string } = {}): Array<{ value: string; label: string }> {
  const known = new Set(categories.map((category) => category._id));
  const roots = categories.filter((category) => !category.parentId || !known.has(category.parentId));
  const name = (category: Category) => category.name.en || category.name.ar || category.slug;
  const result: Array<{ value: string; label: string }> = [];
  const visit = (category: Category, path: string[]) => {
    if (category._id === options.excludeSubtreeOf) return;
    const label = [...path, name(category)];
    result.push({ value: category._id, label: `${label.join(" › ")}${category.published ? "" : " (unpublished)"}` });
    for (const child of siblingsOf(categories, category._id)) visit(child, label);
  };
  for (const root of siblingsOf(roots, null).concat(roots.filter((category) => category.parentId))) visit(root, []);
  return result;
}

/**
 * The form's publish switch after the parent picker changes — a default the merchant can still change, never a rule:
 * the API is the source of truth (a published sub-category needs a published parent) and refuses anything else.
 *  - creating: follow the new parent — published under a published parent or at the top level, unpublished otherwise;
 *  - editing: only ever switch OFF, when the new parent is unpublished and the category is published (the one state
 *    the API would refuse); never publish an existing category the merchant left unpublished.
 * `parentPublished` is null for the top level and undefined while the parent's state is not known yet (no change).
 */
export function publishedForParent(input: { mode: "create" | "edit"; parentPublished: boolean | null | undefined; published: boolean }): boolean {
  const { mode, parentPublished, published } = input;
  if (parentPublished === undefined) return published;
  if (mode === "create") return parentPublished ?? true;
  return parentPublished === false ? false : published;
}
