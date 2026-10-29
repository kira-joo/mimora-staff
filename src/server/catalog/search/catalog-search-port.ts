import type { PaginatedResponse, SortOrder } from "@kira-joo/toolkit-common";
import type { ProductSchema } from "../product.schema";

export interface CatalogAttributeFilter {
  /** Matches `Product.attributes[].key` — e.g. `"material"`. */
  key: string;
  /** Matches `Product.attributes[].values[].key` — e.g. `"cotton"`. */
  valueKey: string;
}

export interface CatalogOptionFilter {
  /** An option-axis key — e.g. `"size"`. */
  key: string;
  /** The value on that axis — e.g. `"m"`. */
  value: string;
}

export type CatalogSort = "newest" | "price_asc" | "price_desc";

/** The scope a listing and its facet counts are both computed over. */
export interface CatalogScope {
  search?: string;
  /** Includes the category's published descendants — a parent category page lists its children's products. */
  categoryId?: string;
  collectionId?: string;
}

export interface CatalogSearchQuery extends CatalogScope {
  brandId?: string;
  /** Inclusive. Filters on `Product.listing.{minActivePrice,maxActivePrice}` — a product matches if its own active price range overlaps `[minPrice, maxPrice]`, not merely if one bound sits inside it. */
  minPrice?: string;
  maxPrice?: string;
  /**
   * Entries sharing a `key` are alternatives (OR); different keys must all
   * match (AND) — a product missing any requested key is excluded.
   * `Product.attributes[]` groups values under their axis on purpose (see that
   * field's own doc comment), so matching "material=cotton" is an `$elemMatch`
   * on one array entry, not two independent field checks that could straddle
   * different attributes.
   */
  attributes?: CatalogAttributeFilter[];
  /**
   * Variant option axes (size, colour). Entries sharing a `key` are alternatives
   * (OR); different keys must all match (AND). Matched against the values on
   * PURCHASABLE variants (`Product.listing.availableOptions`), so a value that
   * only a sold-out variant carries does not match.
   */
  options?: CatalogOptionFilter[];
  /** Only products with at least one purchasable variant (`listing.purchasableVariantCount > 0`). */
  inStock?: boolean;
  /** `newest` (default) is `createdAt` descending. Price sorts use `listing.minActivePrice`, products without a price last. Takes precedence over `sortBy`. */
  sort?: CatalogSort;
  /** Pass-through of the toolkit's single-field sort, for callers that do not use `sort`. */
  sortBy?: string;
  sortOrder?: SortOrder;
  page?: number;
  limit?: number;
}

export interface CatalogFacetValue {
  key: string;
  count: number;
}

export interface CatalogAttributeFacet {
  key: string;
  values: CatalogFacetValue[];
}

export interface CatalogOptionFacet {
  /** The option-axis key — e.g. `"size"`. */
  key: string;
  /** Each value with the number of products that can be bought in it. */
  values: CatalogFacetValue[];
}

export interface CatalogPriceRangeFacet {
  min?: string;
  max?: string;
}

export interface CatalogFacets {
  categories: CatalogFacetValue[];
  brands: CatalogFacetValue[];
  /** The overall min/max of every published product's own active price range — bounds for a storefront price slider, not a bucketed histogram (no route or design calls for buckets yet; add them behind this same interface if that changes). */
  priceRange: CatalogPriceRangeFacet;
  /** One entry per attribute axis actually present on a published product, each with its own per-value counts. Empty until products carry real `attributes[]` data. */
  attributes: CatalogAttributeFacet[];
  /** Variant option axes (size, colour) counted over PURCHASABLE variants only — a value present only on a sold-out variant is not listed. */
  options: CatalogOptionFacet[];
  /** Products in scope with at least one purchasable variant — the count behind the in-stock toggle. */
  inStockCount: number;
}

/**
 * The seam between storefront catalog search/facets routes and whatever
 * actually executes them.
 *
 * Per the architecture review's explicit direction: MongoDB-native search
 * (the toolkit's existing `@Searchable()`/regex-`$or` mechanism, via
 * `findAllAndCountPublic`) is sufficient for v1 — no Atlas Search, no
 * Elasticsearch, no justification for either yet. This interface exists so
 * that if that changes later, a new implementation of `CatalogSearchPort`
 * is what changes — not every storefront route that currently calls
 * `search()`/`facets()`.
 *
 * **Extended by the Phase 4B verification/foundation-completion pass** to
 * add price-range and attribute filtering/faceting — the first version only
 * covered category/brand/free-text, which the canonical storefront product-
 * list and facets routes both need more than. No route calls this yet
 * (still no routes built); the interface and implementation exist so
 * Phase 4B's storefront-catalog batch has the full seam ready from the
 * start.
 */
export interface CatalogSearchPort {
  search(query: CatalogSearchQuery): Promise<PaginatedResponse<ProductSchema>>;
  /** Counts over the same scope (`search`/`categoryId`/`collectionId`) a listing would use; no scope counts the whole published catalogue. */
  facets(scope?: CatalogScope): Promise<CatalogFacets>;
}
