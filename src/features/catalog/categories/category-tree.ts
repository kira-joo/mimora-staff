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
