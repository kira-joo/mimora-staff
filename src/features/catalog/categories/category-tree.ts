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
