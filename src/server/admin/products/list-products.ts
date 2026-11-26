import { buildSearchFilter, combineFilters, getMergedSchemaMetadata } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import type { LocalizedString, ImageAsset, Money, PaginatedResponse } from "@kira-joo/toolkit-common";
import { ProductSchema } from "../../catalog/product.schema";
import { findProductsPage } from "../../catalog/search/product-sort";
import type { ListAdminProductsQueryDto } from "../dto/list-admin-products-query.dto";
import type { WithTimestamps } from "../../core/with-timestamps";

export interface ProductListView {
  _id: string;
  name: LocalizedString;
  slug: string;
  categoryId: string;
  brandId?: string;
  lifecycle: "draft" | "published" | "archived";
  publishAt?: Date;
  order: number;
  /** The product group it belongs to, if any, and its label there. */
  group?: { groupId: string; label: LocalizedString; order: number };
  listing: {
    minActivePrice?: Money;
    maxActivePrice?: Money;
    purchasableVariantCount: number;
    primaryImage?: ImageAsset;
  };
  ratingsSummary: {
    average: number;
    count: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filters, free-text search and one of the `sort` orders (default `manual`). Search is the same `@Searchable()`
 * name/description match the toolkit's list queries use; it is built here because a deterministic multi-key sort needs
 * an aggregation, which the repository's single-field sort cannot express.
 */
export async function listProducts(query: ListAdminProductsQueryDto): Promise<PaginatedResponse<ProductListView>> {
  const { categoryId, brandId, collectionId, lifecycle, search, ids, sort = "manual", page, limit } = query;
  const objectId = (id: string) => new mongoose.Types.ObjectId(id);
  const filter = combineFilters(
    categoryId ? { categoryId: objectId(categoryId) } : undefined,
    brandId ? { brandId: objectId(brandId) } : undefined,
    collectionId ? { collectionIds: objectId(collectionId) } : undefined,
    lifecycle ? { lifecycle } : undefined,
    ids?.length ? { _id: { $in: ids.map(objectId) } } : undefined,
    buildSearchFilter(getMergedSchemaMetadata(ProductSchema), search)
  );

  const result = await findProductsPage(filter, sort, { page, limit });

  return {
    ...result,
    data: result.data.map((p) => ({
      _id: p._id.toString(),
      name: p.name,
      slug: p.slug,
      categoryId: p.categoryId.toString(),
      brandId: p.brandId?.toString(),
      lifecycle: p.lifecycle,
      publishAt: p.publishAt,
      order: p.order,
      group: p.group ? { groupId: p.group.groupId.toString(), label: p.group.label, order: p.group.order } : undefined,
      listing: p.listing,
      ratingsSummary: p.ratingsSummary,
      createdAt: (p as WithTimestamps<typeof p>).createdAt,
      updatedAt: (p as WithTimestamps<typeof p>).updatedAt,
    })),
  };
}
