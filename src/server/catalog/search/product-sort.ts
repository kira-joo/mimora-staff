import { resolvePagination } from "@kira-joo/backend-toolkit-mongoose";
import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import type mongoose from "mongoose";
import { ProductModel, type ProductSchema } from "../product.schema";
import { productRepository } from "../../core/repositories";

/**
 * The one definition of how a product listing is ordered, shared by the storefront's listing/search and the console's
 * product list, so the two can never disagree about what "manual" or "price" means.
 *
 * - `manual`: `order` ascending, ties newest first — the same canonical order as `engines/product-order`. While every
 *   product holds the default `order: 0` this is exactly `newest`.
 * - `newest` / `oldest`: `createdAt`, with `_id` as the tie-breaker.
 * - `price_asc` / `price_desc`: the product's lowest active price; products with no price always last.
 */
export const PRODUCT_LIST_SORTS = ["manual", "newest", "oldest", "price_asc", "price_desc"] as const;
export type ProductListSort = (typeof PRODUCT_LIST_SORTS)[number];

export function productSortStages(sort: ProductListSort): mongoose.PipelineStage[] {
  switch (sort) {
    case "manual":
      // A missing or null `order` reads as 0 — the same effective rank the engine and the normalisation script use
      // (MongoDB would otherwise sort a missing field BEFORE 0).
      return [{ $addFields: { manualRank: { $ifNull: ["$order", 0] } } }, { $sort: { manualRank: 1, createdAt: -1, _id: -1 } }];
    case "newest":
      return [{ $sort: { createdAt: -1, _id: -1 } }];
    case "oldest":
      return [{ $sort: { createdAt: 1, _id: 1 } }];
    case "price_asc":
    case "price_desc":
      return [
        // `sortPrice` in decimal: a Double 19.99 and an (older) Decimal128 19.99 are then equal, so the createdAt/_id
        // tie-breakers decide between them, as they did when every record had the same type.
        { $addFields: { noPrice: { $cond: [{ $in: [{ $type: "$listing.minActivePrice" }, ["missing", "null"]] }, 1, 0] }, sortPrice: { $toDecimal: "$listing.minActivePrice" } } },
        { $sort: { noPrice: 1, sortPrice: sort === "price_asc" ? 1 : -1, createdAt: -1, _id: -1 } },
      ];
  }
}

/**
 * One page of the products matching `filter` (already cast: an aggregation `$match` does not cast ids), in `sort` order.
 * A computed sort key needs an aggregation, which yields the ordered ids for the page; the documents themselves are then
 * loaded through the repository so they serialise exactly as every other listing's do.
 */
export async function findProductsPage(filter: Record<string, unknown>, sort: ProductListSort, paging: { page?: number; limit?: number }): Promise<PaginatedResponse<ProductSchema>> {
  const pagination = resolvePagination(paging);

  const [total, rows] = await Promise.all([
    ProductModel.countDocuments(filter),
    ProductModel.aggregate<{ _id: mongoose.Types.ObjectId }>([
      { $match: filter },
      ...productSortStages(sort),
      { $skip: pagination.skip },
      { $limit: pagination.limit },
      { $project: { _id: 1 } },
    ]),
  ]);

  // The filter is applied again: a product archived (or otherwise leaving the filter) between the two reads must not be
  // served from this page just because the first read chose its id.
  const documents = await productRepository.findAll({ where: { $and: [filter, { _id: { $in: rows.map((row) => row._id) } }] } });
  const byId = new Map(documents.map((document) => [document._id.toString(), document]));

  return {
    data: rows.flatMap((row) => byId.get(row._id.toString()) ?? []),
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit),
  };
}
