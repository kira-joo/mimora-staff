import type { PaginatedResponse } from "@kira-joo/toolkit-common";
import { mongoCatalogSearchPort } from "../catalog/search/mongo-catalog-search-port";
import { resolveListingLowStock } from "../catalog/rollups/listing-options";
import type { ProductSchema } from "../catalog/product.schema";
import type { ListStorefrontProductsQueryDto } from "../catalog/dto/list-storefront-products-query.dto";
import { inventorySettingsRepository } from "../core/repositories";

/** The `InventorySettings.lowStockThreshold` schema default, used only before a store has any settings document. */
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** What a listing card reads beyond the stored document: the resolved low-stock signal (a boolean — never the quantity). */
export type StorefrontListingProduct = Omit<ProductSchema, "listing"> & {
  listing: Omit<ProductSchema["listing"], "lowStockOverride" | "minTrackedStock"> & { lowStock: boolean };
};

/** Delegates to `CatalogSearchPort` — the seam Phase 4A.5's foundation-completion pass built specifically so this route never hardcodes a query shape the search implementation would then have to be unpicked from. */
export async function getProducts(query: ListStorefrontProductsQueryDto): Promise<PaginatedResponse<StorefrontListingProduct>> {
  const page = await mongoCatalogSearchPort.search({
    search: query.search,
    categoryId: query.categoryId,
    collectionId: query.collectionId,
    brandId: query.brandId,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    attributes: parseAttributeFilters(query.attr),
    options: parseOptionFilters(query.opt),
    inStock: query.inStock,
    sort: query.sort,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    page: query.page,
    limit: query.limit,
  });
  return { ...page, data: await withLowStock(page.data) };
}

/**
 * Resolves the card's low-stock signal against the CURRENT store-wide threshold,
 * and drops the rollup's raw facts from the response. The facts are stored
 * threshold-independent precisely so that changing the setting needs no recompute;
 * the one place that applies the setting is here.
 */
async function withLowStock(products: ProductSchema[]): Promise<StorefrontListingProduct[]> {
  if (products.length === 0) return [];
  const settings = await inventorySettingsRepository.findOne({ where: {}, skipThrowError: true });
  const threshold = settings?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

  return products.map((product) => {
    // `toJSON` applies the schema's serialisation (money, `__v`); a lean document has none and is already plain.
    const plain = (typeof (product as { toJSON?: () => unknown }).toJSON === "function" ? (product as unknown as { toJSON: () => ProductSchema }).toJSON() : product) as ProductSchema;
    const { lowStockOverride, minTrackedStock, ...listing } = plain.listing ?? ({} as ProductSchema["listing"]);
    return { ...plain, listing: { ...listing, lowStock: resolveListingLowStock({ lowStockOverride, minTrackedStock }, threshold) } };
  });
}

/** `["material:cotton"]` -> `{key: "material", valueKey: "cotton"}`, split at the first colon. The DTO has already guaranteed the shape. */
function parseAttributeFilters(attr: string[] | undefined) {
  return attr?.map((entry) => {
    const colon = entry.indexOf(":");
    return { key: entry.slice(0, colon), valueKey: entry.slice(colon + 1) };
  });
}

/** `["size:m"]` -> `{key: "size", value: "m"}`, split at the first colon. */
function parseOptionFilters(opt: string[] | undefined) {
  return opt?.map((entry) => {
    const colon = entry.indexOf(":");
    return { key: entry.slice(0, colon), value: entry.slice(colon + 1).trim() };
  });
}
