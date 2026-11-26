import { BaseFindQueryDto } from "@kira-joo/backend-toolkit-core";
import { MONEY_SCALE, roundMoney, type PaginatedResponse } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { BrandModel } from "../brand.schema";
import { CategoryModel } from "../category.schema";
import { ProductModel } from "../product.schema";
import { VariantModel } from "../variant.schema";
import { productRepository } from "../../core/repositories";
import { collectCategoryTreeIds } from "./collect-category-tree";
import { findProductsPage } from "./product-sort";
import { optionPair } from "../rollups/listing-options";
import { searchRegex, searchTokens } from "./normalize-search-text";
import type { ProductSchema } from "../product.schema";
import type { CatalogAttributeFacet, CatalogFacets, CatalogOptionFacet, CatalogScope, CatalogSearchPort, CatalogSearchQuery } from "./catalog-search-port";

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

    // `sort` wins; with neither `sort` nor a pass-through `sortBy`, the listing is the owner's manual order.
    if (query.sort || !query.sortBy) return findProductsPage(filter, query.sort ?? "manual", { page: query.page, limit: query.limit });

    // `search` is already inside `filter` (normalised, brand- and SKU-aware); the toolkit's own `@Searchable` regex must not run on top of it.
    const listQuery = new BaseFindQueryDto();
    listQuery.page = query.page;
    listQuery.limit = query.limit;
    listQuery.sortBy = query.sortBy;
    listQuery.sortOrder = query.sortOrder;

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
        // A brand is optional, and "no brand" is stored both ways: the field absent (a create without one) and `null`
        // (an edit choosing "No brand"). `$ne: null` matches neither, so only real brand ids are counted — `$exists`
        // let a stored null through as a `null` group, and `.toString()` on it failed every facet in that scope.
        { $match: { ...base, brandId: { $ne: null } } },
        { $group: { _id: "$brandId", count: { $sum: 1 } } },
      ]),
      ProductModel.aggregate<{ min?: mongoose.Types.Decimal128; max?: mongoose.Types.Decimal128 }>([
        { $match: base },
        // `$toDecimal`, so the range is exact whether a record holds Double or (older) Decimal128.
        { $group: { _id: null, min: { $min: { $toDecimal: "$listing.minActivePrice" } }, max: { $max: { $toDecimal: "$listing.maxActivePrice" } } } },
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
      // Two decimals, as the stored Decimal128 always printed ("19.50"); `$toDecimal` of a double prints 15 digits.
      priceRange: { min: facetPrice(priceRange[0]?.min), max: facetPrice(priceRange[0]?.max) },
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
/** A facet bound as the two-decimal string the stored Decimal128 always printed ("19.50"), or undefined when absent. */
function facetPrice(value: mongoose.Types.Decimal128 | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : roundMoney(value.toString()).toFixed(MONEY_SCALE);
}

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

/** A product matches when its own active price range OVERLAPS the query's — not merely when one bound falls inside it, since a product spanning $10-$50 is relevant to a $20-$30 query even though neither of its own bounds sits in that range. */
/**
 * Compared in decimal (`$toDecimal`), because a listing price is stored as BSON Double (older records: Decimal128)
 * and MongoDB compares mixed numeric types by exact value: a stored double 19.99 is 19.989999…, so `>= 19.99` as a
 * Decimal128 bound would drop a product priced exactly at the bound, and a double bound would do the same to a
 * Decimal128 record. `$toDecimal` reads a double through its shortest decimal form, so both compare as 19.99.
 * `$type: "number"` keeps the old filter's behaviour of never matching a product with no price (in `$expr`, null
 * sorts below every number and would otherwise pass a `$lte`).
 */
function buildPriceRangeFilter(minPrice: string | undefined, maxPrice: string | undefined): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const conditions: unknown[] = [];
  if (maxPrice !== undefined) {
    filter["listing.minActivePrice"] = { $type: "number" };
    conditions.push({ $lte: [{ $toDecimal: "$listing.minActivePrice" }, mongoose.Types.Decimal128.fromString(maxPrice)] });
  }
  if (minPrice !== undefined) {
    filter["listing.maxActivePrice"] = { $type: "number" };
    conditions.push({ $gte: [{ $toDecimal: "$listing.maxActivePrice" }, mongoose.Types.Decimal128.fromString(minPrice)] });
  }
  if (conditions.length > 0) filter.$expr = conditions.length === 1 ? conditions[0] : { $and: conditions };
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
