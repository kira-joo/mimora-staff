import { BaseFindQueryDto, ToArray, ToBoolean } from "@kira-joo/backend-toolkit-core";
import { IsBoolean, IsIn, IsMongoId, IsOptional, Matches } from "class-validator";

/** Matches a non-negative decimal amount with up to 2 fraction digits — the same shape `toMoney()` accepts as a string. */
const MONEY_STRING_PATTERN = /^\d+(\.\d{1,2})?$/;

/** `key:value` — a non-empty key with no colon, then a non-empty value. */
const ATTRIBUTE_FILTER_PATTERN = /^[^:\s][^:]*:.+$/;

/** `axis:value` — a non-empty axis key with no colon or whitespace, then a non-empty value (split at the FIRST colon, so a value may itself contain spaces). */
const OPTION_FILTER_PATTERN = /^[^:\s][^:]*:.+$/;

export const STOREFRONT_PRODUCT_SORTS = ["newest", "price_asc", "price_desc"] as const;

/**
 * Query DTO for `GET /api/storefront/products`. Extends `search`/`page`/
 * `limit` (and the toolkit's own `sortBy`/`sortOrder`) from
 * `BaseFindQueryDto` with the filters the `CatalogSearchPort` supports.
 *
 * - `categoryId` also matches the category's published descendants.
 * - `sort` takes precedence over `sortBy`; default order is newest first.
 * - `attr` is repeated `attr=key:value` (split at the FIRST colon). Values of
 *   one key are alternatives, different keys all must match.
 * - `opt` is repeated `opt=axis:value` over the variant option axes (size,
 *   colour), same OR-within-key / AND-across-keys rule, matched against values
 *   on purchasable variants only.
 * - `inStock=true` keeps only products with a purchasable variant.
 */
export class ListStorefrontProductsQueryDto extends BaseFindQueryDto {
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @IsOptional()
  @IsMongoId()
  brandId?: string;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: "minPrice must be a non-negative decimal amount, e.g. \"10.00\"." })
  minPrice?: string;

  @IsOptional()
  @Matches(MONEY_STRING_PATTERN, { message: "maxPrice must be a non-negative decimal amount, e.g. \"10.00\"." })
  maxPrice?: string;

  @IsOptional()
  @IsMongoId()
  collectionId?: string;

  @IsOptional()
  @IsIn(STOREFRONT_PRODUCT_SORTS)
  sort?: (typeof STOREFRONT_PRODUCT_SORTS)[number];

  @IsOptional()
  @ToArray({ separator: "|" })
  @Matches(ATTRIBUTE_FILTER_PATTERN, { each: true, message: "attr must be key:value, e.g. \"material:cotton\"." })
  attr?: string[];

  @IsOptional()
  @ToArray({ separator: "|" })
  @Matches(OPTION_FILTER_PATTERN, { each: true, message: "opt must be axis:value, e.g. \"size:m\"." })
  opt?: string[];

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  inStock?: boolean;
}
