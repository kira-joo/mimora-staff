export interface CategoryNode {
  _id: { toString(): string };
  parentId?: { toString(): string } | null;
  published: boolean;
}

/**
 * The root category's id plus every PUBLISHED descendant's — a parent page
 * lists its children's products. The walk only descends through published
 * categories: an unpublished node hides its whole subtree, as it does in the
 * storefront's own category tree. A cycle in `parentId` data cannot loop it.
 */
export function collectCategoryTreeIds(rootId: string, categories: CategoryNode[]): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const category of categories) {
    if (!category.published || !category.parentId) continue;
    const parent = category.parentId.toString();
    childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), category._id.toString()]);
  }

  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    for (const child of childrenByParent.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return [...seen];
}
