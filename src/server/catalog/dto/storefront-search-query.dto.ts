import { Trim } from "@kira-joo/backend-toolkit-core";
import { IsString } from "class-validator";
import { ListStorefrontProductsQueryDto } from "./list-storefront-products-query.dto";

/**
 * `GET /api/storefront/search` — the search term `q` plus EVERY filter, sort and page parameter the listing route takes
 * (`inStock`, `opt`, `attr`, price, category, …). It extends `ListStorefrontProductsQueryDto` rather than restating a
 * subset, so the two routes cannot drift: a filter added to the listing is a filter of search on the same commit, and
 * both go through the same `CatalogSearchPort` and the same `getProducts` projection (including the `lowStock` signal).
 *
 * `q` is the canonical term here; if a client also sends `search`, `q` wins.
 */
export class StorefrontSearchQueryDto extends ListStorefrontProductsQueryDto {
  @IsString()
  @Trim()
  q!: string;
}
