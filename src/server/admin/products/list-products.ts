import { SortOrder } from "@kira-joo/toolkit-common";
import type { LocalizedString, ImageAsset, Money, PaginatedResponse } from "@kira-joo/toolkit-common";
import { productRepository } from "../../core/repositories";
import type { ListAdminProductsQueryDto } from "../dto/list-admin-products-query.dto";

export interface ProductListView {
  _id: string;
  name: LocalizedString;
  slug: string;
  categoryId: string;
  brandId?: string;
  lifecycle: "draft" | "published" | "archived";
  publishAt?: Date;
  order: number;
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

/** `search` is handled automatically by `@Searchable()` on Product.name/description — no manual $text filter needed. */
export async function listProducts(query: ListAdminProductsQueryDto): Promise<PaginatedResponse<ProductListView>> {
  const { categoryId, brandId, collectionId, lifecycle, ...rest } = query;
  const where: Record<string, unknown> = {};

  if (categoryId) where.categoryId = categoryId;
  if (brandId) where.brandId = brandId;
  if (collectionId) where.collectionIds = collectionId;
  if (lifecycle) where.lifecycle = lifecycle;

  const result = await productRepository.findAllAndCountPublic({
    where,
    sort: { field: "order", order: SortOrder.ASC },
    query: rest,
  });

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
      listing: p.listing,
      ratingsSummary: p.ratingsSummary,
      createdAt: (p as any).createdAt,
      updatedAt: (p as any).updatedAt,
    })),
  };
}
