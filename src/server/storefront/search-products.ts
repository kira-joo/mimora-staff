import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import type { StorefrontSearchQueryDto } from "../catalog/dto/storefront-search-query.dto";
import { getProducts, type StorefrontListingProduct } from "./get-products";

/**
 * Search is the listing with a term: the same port, the same query builder, the same card projection (resolved
 * `lowStock`, no raw stock facts) as `getProducts`, so `/api/storefront/search` honours `inStock`, `opt` and every
 * other listing filter identically. There is deliberately no second implementation of any of it.
 */
export async function searchProducts(query: StorefrontSearchQueryDto): Promise<PaginatedResponse<StorefrontListingProduct>> {
  const { q, ...rest } = query;
  return getProducts({ ...rest, search: q });
}
