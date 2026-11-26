import { BadRequestError, ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { resolveSession, trackWrite, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { CategoryModel } from "../../catalog/category.schema";
import { CollectionModel } from "../../catalog/collection.schema";
import { ProductModel } from "../../catalog/product.schema";
import { collectCategoryTreeIds } from "../../catalog/search/collect-category-tree";
import { CONTENDED_MAX_RETRIES, backOffBeforeRetry } from "../../core/transactions/contention-backoff";
import { applyScopedOrder, orderChanges, sortProductsManual } from "../../engines/product-order/product-order";

export interface ProductOrderScope {
  categoryId?: string;
  collectionId?: string;
}

/** What the arrange screen needs of a product — a light projection, never the whole document. */
export interface ArrangeProductView {
  _id: string;
  name: { ar: string; en: string };
  slug: string;
  lifecycle: "draft" | "published" | "archived";
  categoryId: string;
  listing: { primaryImage?: ImageAsset };
}

interface ScopedProduct {
  _id: mongoose.Types.ObjectId;
  name: ArrangeProductView["name"];
  slug: string;
  lifecycle: ArrangeProductView["lifecycle"];
  categoryId: mongoose.Types.ObjectId;
  order: number;
  createdAt: Date;
  listing?: { primaryImage?: ImageAsset };
}

/** A category scope and a collection scope are different questions; asking both at once has no single answer. */
export function assertSingleScope(scope: ProductOrderScope): void {
  if (scope.categoryId && scope.collectionId) throw new BadRequestError("Arrange by a category or a collection, not both.");
}

const sessionOrNull = () => resolveSession() ?? null;

/**
 * The filter for the products in a scope. A category scope is the category AND all its descendants — whether or not
 * they are published, because an arrangement is staff-side and unpublished products still hold a place. Archived
 * products are never part of a scope (they are not shown, and keep their slot in the global order).
 */
async function scopeFilter(scope: ProductOrderScope): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = { lifecycle: { $ne: "archived" } };

  if (scope.categoryId) {
    const categories = await CategoryModel.find({}, { parentId: 1 }, { session: resolveSession() }).lean();
    if (!categories.some((category) => category._id.toString() === scope.categoryId)) throw new NotFoundError("Category not found");
    // `collectCategoryTreeIds` only descends published nodes; an arrangement must see the whole subtree.
    const everyNodePublished = categories.map((category) => ({ _id: category._id, parentId: category.parentId, published: true }));
    filter.categoryId = { $in: collectCategoryTreeIds(scope.categoryId, everyNodePublished).map((id) => new mongoose.Types.ObjectId(id)) };
  }
  if (scope.collectionId) {
    if (!(await CollectionModel.exists({ _id: scope.collectionId }).session(sessionOrNull()))) throw new NotFoundError("Collection not found");
    filter.collectionIds = new mongoose.Types.ObjectId(scope.collectionId);
  }
  return filter;
}

async function loadScope(scope: ProductOrderScope): Promise<ScopedProduct[]> {
  const products = await ProductModel.find(await scopeFilter(scope), { name: 1, slug: 1, lifecycle: 1, categoryId: 1, order: 1, createdAt: 1, "listing.primaryImage": 1 }, { session: resolveSession() }).lean<ScopedProduct[]>();
  // A missing rank reads as 0 here exactly as in every listing (`product-sort.ts`), so the screen and the storefront agree.
  return sortProductsManual(products.map((product) => ({ ...product, order: product.order ?? 0, id: product._id.toString() })));
}

/** Every non-archived product in the scope, in the canonical manual order, unpaginated. */
export async function listProductsForArrangement(scope: ProductOrderScope): Promise<ArrangeProductView[]> {
  assertSingleScope(scope);
  const products = await loadScope(scope);
  return products.map((product) => ({
    _id: product._id.toString(),
    name: product.name,
    slug: product.slug,
    lifecycle: product.lifecycle,
    categoryId: product.categoryId.toString(),
    listing: { primaryImage: product.listing?.primaryImage },
  }));
}

/**
 * Makes `productIds` the new order of the scope, in one transaction. The submitted ids must be exactly the scope's
 * current members (a product added, archived or moved since the screen loaded is a 409 — nothing is written, and the
 * screen reloads). The scope's members keep the global positions they occupy and take the new sequence; every other
 * product, in any other category, stays where it is. Only products whose `order` actually changes are written, and not
 * their `updatedAt`, so an open product form is not reset.
 */
export async function reorderProducts(scope: ProductOrderScope, productIds: string[]): Promise<{ updated: number }> {
  assertSingleScope(scope);

  return withTransaction(
    async (tx) => {
      await backOffBeforeRetry(tx.attempt);

      const current = await loadScope(scope);
      const currentIds = new Set(current.map((product) => product._id.toString()));
      if (productIds.length !== currentIds.size || productIds.some((id) => !currentIds.has(id))) {
        throw new ConflictError("The product list changed since you opened it. Reload and arrange again.");
      }

      const everyProduct = await ProductModel.find({}, { order: 1, createdAt: 1 }, { session: resolveSession() }).lean<Array<Pick<ScopedProduct, "_id" | "order" | "createdAt">>>();
      const globalOrder = sortProductsManual(everyProduct.map((product) => ({ id: product._id.toString(), order: product.order ?? 0, createdAt: product.createdAt })));
      const changes = orderChanges(new Map(globalOrder.map((product) => [product.id, product.order])), applyScopedOrder(globalOrder.map((product) => product.id), productIds));

      if (changes.length > 0) {
        await trackWrite(() =>
          ProductModel.bulkWrite(
            changes.map((change) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(change.id) }, update: { $set: { order: change.order } } } })),
            { session: resolveSession(), timestamps: false }
          )
        );
      }
      return tx.complete({ updated: changes.length });
    },
    { maxRetries: CONTENDED_MAX_RETRIES }
  );
}
