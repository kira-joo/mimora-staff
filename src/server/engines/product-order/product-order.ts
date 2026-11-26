/**
 * Manual product ordering — pure, no I/O.
 *
 * `Product.order` is the persistent manual position. The CANONICAL order of the whole catalogue is `order` ascending,
 * then `createdAt` DESCENDING, then `_id` DESCENDING. Ties break newest-first so that, while every product still holds
 * the default `order: 0`, the catalogue reads exactly as it did before manual ordering existed (newest first).
 *
 * A "scope" (a category with its descendants, or a collection) is a SUBSET of the catalogue. Arranging a scope must
 * never move anything outside it, so a scoped arrangement is merged back into the one global order: the scope's
 * members keep the global POSITIONS they occupy and are re-filled in the new sequence.
 */

export interface OrderableProduct {
  id: string;
  order: number;
  createdAt: Date | string | number;
}

export class ProductOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductOrderError";
  }
}

const time = (value: OrderableProduct["createdAt"]): number => {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

/** The canonical comparator: `order` asc, `createdAt` desc, `id` desc (ObjectId hex sorts chronologically). */
export function compareProductsManual(a: OrderableProduct, b: OrderableProduct): number {
  if (a.order !== b.order) return a.order - b.order;
  const byCreated = time(b.createdAt) - time(a.createdAt);
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** A new array in canonical order; the input is untouched. */
export function sortProductsManual<T extends OrderableProduct>(products: readonly T[]): T[] {
  return [...products].sort(compareProductsManual);
}

/**
 * The new global order after arranging a scope. `newScopeOrder` is the scope's complete membership in its new
 * sequence. Throws on a duplicate id or an id that is not in the global order.
 */
export function applyScopedOrder(globalOrderedIds: readonly string[], newScopeOrder: readonly string[]): string[] {
  const scope = new Set<string>();
  for (const id of newScopeOrder) {
    if (scope.has(id)) throw new ProductOrderError(`Duplicate product id in the new order: ${id}`);
    scope.add(id);
  }
  const globalSet = new Set(globalOrderedIds);
  if (globalSet.size !== globalOrderedIds.length) throw new ProductOrderError("Duplicate product id in the global order.");
  for (const id of newScopeOrder) {
    if (!globalSet.has(id)) throw new ProductOrderError(`Unknown product id: ${id}`);
  }

  let next = 0;
  return globalOrderedIds.map((id) => (scope.has(id) ? newScopeOrder[next++]! : id));
}

export interface OrderChange {
  id: string;
  order: number;
}

/**
 * The writes needed to make `newGlobalOrder` the stored order: position `i` becomes `order = i + 1` (1..N), and only
 * products whose stored `order` differs are returned, so an unchanged catalogue produces no writes.
 */
export function orderChanges(currentOrderById: ReadonlyMap<string, number>, newGlobalOrder: readonly string[]): OrderChange[] {
  const seen = new Set<string>();
  const changes: OrderChange[] = [];
  newGlobalOrder.forEach((id, index) => {
    if (seen.has(id)) throw new ProductOrderError(`Duplicate product id in the new order: ${id}`);
    seen.add(id);
    const order = index + 1;
    if (currentOrderById.get(id) !== order) changes.push({ id, order });
  });
  return changes;
}
