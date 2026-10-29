import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";
import { resolvePagination } from "@kira-joo/backend-toolkit-mongoose";
import { SortOrder, type PaginatedResponse } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { BrandModel } from "../brand.schema";
import { CategoryModel } from "../category.schema";
import { ProductModel } from "../product.schema";
import { VariantModel } from "../variant.schema";
import { productRepository } from "../../core/repositories";
import { collectCategoryTreeIds } from "./collect-category-tree";
import { optionPair } from "../rollups/listing-options";
import { searchRegex, searchTokens } from "./normalize-search-text";
import type { ProductSchema } from "../product.schema";
import type { CatalogAttributeFacet, CatalogFacets, CatalogOptionFacet, CatalogScope, CatalogSearchPort, CatalogSearchQuery, CatalogSort } from "./catalog-search-port";

/**
 * MongoDB-native implementation of {@link CatalogSearchPort} — Arabic-aware
 * regex text search (name, description, brand name, variant SKU; see
 * `buildSearchClause`), plus direct aggregations for price-range, attribute and
 * option filtering and every facet count, none of which the toolkit has a
 * built-in helper for.
 */
export const mongoCatalogSearchPort: CatalogSearchPort = {
  async search(query: CatalogSearchQuery): Promise<PaginatedResponse<ProductSchema>> {
    const filter = composeFilter([
      { lifecycle: "published" },
      await buildScopeFilter(query, { includeSearch: true }),
      query.brandId ? { brandId: new mongoose.Types.ObjectId(query.brandId) } : {},
      buildPriceRangeFilter(query.minPrice, query.maxPrice),
      buildAttributeFilter(query.attributes),
      buildOptionFilter(query.options),
      query.inStock ? { "listing.purchasableVariantCount": { $gt: 0 } } : {},
    ]);

    if (query.sort === "price_asc" || query.sort === "price_desc") {
      return searchByPrice(filter, query.sort, query.page, query.limit);
    }

    // `search` is already inside `filter` (normalised, brand- and SKU-aware); the toolkit's own `@Searchable` regex must not run on top of it.
    const listQuery = new BaseFindQueryDto();
    listQuery.page = query.page;
    listQuery.limit = query.limit;
    if (query.sort === "newest") {
      listQuery.sortBy = "createdAt";
      listQuery.sortOrder = SortOrder.DESC;
    } else if (query.sortBy) {
      listQuery.sortBy = query.sortBy;
      listQuery.sortOrder = query.sortOrder;
    }

    return productRepository.findAllAndCountPublic({ where: filter, query: listQuery });
  },

  async facets(scope: CatalogScope = {}): Promise<CatalogFacets> {
    const base = composeFilter([{ lifecycle: "published" }, await buildScopeFilter(scope, { includeSearch: true })]);

    const [categories, brands, priceRange, attributes, options, inStock] = await Promise.all([
      ProductModel.aggregate<{ _id: string; count: number }>([
        { $match: base },
        { $group: { _id: "$categoryId", count: { $sum: 1 } } },
      ]),
      ProductModel.aggregate<{ _id: string; count: number }>([
        { $match: { ...base, brandId: { $exists: true } } },
        { $group: { _id: "$brandId", count: { $sum: 1 } } },
      ]),
      ProductModel.aggregate<{ min?: mongoose.Types.Decimal128; max?: mongoose.Types.Decimal128 }>([
        { $match: base },
        { $group: { _id: null, min: { $min: "$listing.minActivePrice" }, max: { $max: "$listing.maxActivePrice" } } },
      ]),
      ProductModel.aggregate<{ _id: { attributeKey: string; valueKey: string }; count: number }>([
        { $match: base },
        { $unwind: "$attributes" },
        { $unwind: "$attributes.values" },
        { $group: { _id: { attributeKey: "$attributes.key", valueKey: "$attributes.values.key" }, count: { $sum: 1 } } },
      ]),
      // One row per product per available option pair — `availableOptions` holds only pairs on PURCHASABLE variants, so a count is a count of products you could actually buy that option in.
      ProductModel.aggregate<{ _id: string; count: number }>([
        { $match: base },
        { $unwind: "$listing.availableOptions" },
        { $group: { _id: "$listing.availableOptions", count: { $sum: 1 } } },
      ]),
      ProductModel.countDocuments({ $and: [base, { "listing.purchasableVariantCount": { $gt: 0 } }] }),
    ]);

    return {
      categories: categories.map((entry) => ({ key: entry._id.toString(), count: entry.count })),
      brands: brands.map((entry) => ({ key: entry._id.toString(), count: entry.count })),
      priceRange: { min: priceRange[0]?.min?.toString(), max: priceRange[0]?.max?.toString() },
      attributes: groupAttributeFacets(attributes),
      options: groupOptionFacets(options),
      inStockCount: inStock,
    };
  },
};

/**
 * The scope filters shared by a listing and its facet counts, so the two can
 * never disagree about what is "in scope". Ids are cast to `ObjectId` here —
 * an aggregation `$match` does not cast the way a `find` does.
 */
async function buildScopeFilter(scope: CatalogScope, options: { includeSearch: boolean }): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = {};

  if (scope.categoryId) {
    const categories = await CategoryModel.find({}, { parentId: 1, published: 1 }).lean();
    filter.categoryId = { $in: collectCategoryTreeIds(scope.categoryId, categories).map((id) => new mongoose.Types.ObjectId(id)) };
  }
  if (scope.collectionId) filter.collectionIds = new mongoose.Types.ObjectId(scope.collectionId);

  return options.includeSearch ? composeFilter([filter, await buildSearchClause(scope.search)]) : filter;
}

/**
 * AND of independent clauses. Each clause owns top-level keys (`$or`, `$and`,
 * `categoryId`), so spreading them into one object would let a later clause
 * silently overwrite an earlier one; `$and` cannot collide.
 */
function composeFilter(clauses: Array<Record<string, unknown>>): Record<string, unknown> {
  const present = clauses.filter((clause) => Object.keys(clause).length > 0);
  return present.length === 0 ? {} : present.length === 1 ? present[0]! : { $and: present };
}

/**
 * Free-text search (plan #8). The text is normalised (`normalizeSearchText`) and
 * split into terms; a product matches when EVERY term matches somewhere in:
 * its name or description (either locale), its brand's name, or one of its
 * variants' SKU. Each term is an escaped, Arabic-tolerant regular expression
 * (`buildSearchPattern`), so a query is never a pattern and "احمد" finds "أحمد"
 * and "محمد" finds "مُحَمَّد".
 *
 * Brand and SKU live outside the product document, so each term first resolves
 * the (few) published brands whose name matches and the products whose live
 * variant SKU matches, then folds the ids into the same `$or`. Resolving brands
 * at query time — rather than copying the name into the product rollup — means a
 * brand rename needs no recompute of every product it owns.
 */
async function buildSearchClause(search: string | undefined): Promise<Record<string, unknown>> {
  const tokens = searchTokens(search);
  if (tokens.length === 0) return {};

  const perToken = await Promise.all(
    tokens.map(async (token) => {
      const regex = searchRegex(token);
      const [brands, skuProductIds] = await Promise.all([
        BrandModel.find({ published: true, $or: [{ "name.ar": regex }, { "name.en": regex }] }, { _id: 1 }).lean(),
        VariantModel.distinct("productId", { discontinued: false, sku: regex }),
      ]);
      return {
        $or: [
          { "name.ar": regex },
          { "name.en": regex },
          { "description.ar": regex },
          { "description.en": regex },
          ...(brands.length > 0 ? [{ brandId: { $in: brands.map((brand) => brand._id) } }] : []),
          ...(skuProductIds.length > 0 ? [{ _id: { $in: skuProductIds } }] : []),
        ],
      };
    })
  );

  return { $and: perToken };
}

/**
 * Price sorts cannot go through the repository: "products without a price
 * last" needs a computed key, which only an aggregation can sort on. The
 * aggregation yields the ordered ids for the page; the documents themselves
 * are then loaded through the repository so they serialise exactly as every
 * other listing's do.
 */
async function searchByPrice(filter: Record<string, unknown>, sort: Exclude<CatalogSort, "newest">, page?: number, limit?: number): Promise<PaginatedResponse<ProductSchema>> {
  const pagination = resolvePagination({ page, limit });
  const direction = sort === "price_asc" ? 1 : -1;

  const [total, rows] = await Promise.all([
    ProductModel.countDocuments(filter),
    ProductModel.aggregate<{ _id: mongoose.Types.ObjectId }>([
      { $match: filter },
      { $addFields: { noPrice: { $cond: [{ $in: [{ $type: "$listing.minActivePrice" }, ["missing", "null"]] }, 1, 0] } } },
      { $sort: { noPrice: 1, "listing.minActivePrice": direction, createdAt: -1, _id: -1 } },
      { $skip: pagination.skip },
      { $limit: pagination.limit },
      { $project: { _id: 1 } },
    ]),
  ]);

  const documents = await productRepository.findAll({ where: { _id: { $in: rows.map((row) => row._id) } } });
  const byId = new Map(documents.map((document) => [document._id.toString(), document]));

  return {
    data: rows.flatMap((row) => byId.get(row._id.toString()) ?? []),
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages: Math.ceil(total / pagination.limit),
  };
}

/** A product matches when its own active price range OVERLAPS the query's — not merely when one bound falls inside it, since a product spanning $10-$50 is relevant to a $20-$30 query even though neither of its own bounds sits in that range. */
function buildPriceRangeFilter(minPrice: string | undefined, maxPrice: string | undefined): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (maxPrice !== undefined) filter["listing.minActivePrice"] = { $lte: mongoose.Types.Decimal128.fromString(maxPrice) };
  if (minPrice !== undefined) filter["listing.maxActivePrice"] = { $gte: mongoose.Types.Decimal128.fromString(minPrice) };
  return filter;
}

/**
 * Values of one attribute key are alternatives (OR); different keys must all
 * match (AND). Each key is its own `$elemMatch` on one `attributes[]` entry —
 * never independent field checks that could straddle different attributes.
 */
function buildAttributeFilter(attributes: CatalogSearchQuery["attributes"]): Record<string, unknown> {
  if (!attributes || attributes.length === 0) return {};

  const valueKeysByKey = new Map<string, string[]>();
  for (const filter of attributes) valueKeysByKey.set(filter.key, [...(valueKeysByKey.get(filter.key) ?? []), filter.valueKey]);

  return {
    $and: [...valueKeysByKey].map(([key, valueKeys]) => ({
      attributes: { $elemMatch: { key, values: { $elemMatch: { key: { $in: valueKeys } } } } },
    })),
  };
}

/**
 * Option pairs of one key are alternatives (OR); different keys must all match
 * (AND) — each against the product's `availableOptions`, i.e. values on
 * purchasable variants. Existence at product level: "size m" and "colour red"
 * each exist on SOME purchasable variant, not necessarily the same one (the
 * product page resolves the exact combination).
 */
function buildOptionFilter(options: CatalogSearchQuery["options"]): Record<string, unknown> {
  if (!options || options.length === 0) return {};

  const valuesByKey = new Map<string, string[]>();
  for (const filter of options) valuesByKey.set(filter.key, [...(valuesByKey.get(filter.key) ?? []), optionPair(filter.key, filter.value)]);

  return { $and: [...valuesByKey.values()].map((pairs) => ({ "listing.availableOptions": { $in: pairs } })) };
}

/** `size:m` → axis `size`, value `m`. Split at the FIRST colon, as the filter is. */
function groupOptionFacets(rows: Array<{ _id: string; count: number }>): CatalogOptionFacet[] {
  const byAxis = new Map<string, CatalogOptionFacet>();

  for (const row of rows) {
    const colon = row._id.indexOf(":");
    if (colon <= 0) continue;
    const axis = row._id.slice(0, colon);
    const value = { key: row._id.slice(colon + 1), count: row.count };
    const existing = byAxis.get(axis);
    if (existing) existing.values.push(value);
    else byAxis.set(axis, { key: axis, values: [value] });
  }

  return [...byAxis.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function groupAttributeFacets(rows: Array<{ _id: { attributeKey: string; valueKey: string }; count: number }>): CatalogAttributeFacet[] {
  const byAttribute = new Map<string, CatalogAttributeFacet>();

  for (const row of rows) {
    const existing = byAttribute.get(row._id.attributeKey);
    const value = { key: row._id.valueKey, count: row.count };

    if (existing) existing.values.push(value);
    else byAttribute.set(row._id.attributeKey, { key: row._id.attributeKey, values: [value] });
  }

  return [...byAttribute.values()];
}
