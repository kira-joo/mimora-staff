import type { LocalizedString } from "@kira-joo/toolkit-common";
import { ProductModel } from "../catalog/product.schema";
import { mongoCatalogSearchPort } from "../catalog/search/mongo-catalog-search-port";
import type { CatalogFacets, CatalogScope } from "../catalog/search/catalog-search-port";

export interface StorefrontFacetValue {
  key: string;
  label: LocalizedString;
  count: number;
}

export interface StorefrontAttributeFacet {
  key: string;
  name: LocalizedString;
  values: StorefrontFacetValue[];
}

/** A variant option axis (size, colour) with the merchant's names. Counts are over purchasable variants only. */
export interface StorefrontOptionFacet {
  key: string;
  name: LocalizedString;
  values: StorefrontFacetValue[];
}

export interface StorefrontFacets extends Omit<CatalogFacets, "attributes" | "options"> {
  attributes: StorefrontAttributeFacet[];
  options: StorefrontOptionFacet[];
}

interface LabelRow {
  _id: { attributeKey: string; valueKey: string };
  name: LocalizedString;
  label: LocalizedString;
}

/**
 * The catalog search port's facets, with the merchant's own localized names
 * attached to each attribute axis and value.
 *
 * The port counts by KEY (`material` / `cotton`) because that is what a filter
 * sends back, but a key is not something a customer reads. The names live on
 * the products' `attributes[]`, so they are looked up here — for exactly the
 * keys that were counted, nothing else — rather than widening the port's
 * contract for a presentation concern. A key with no readable name falls back
 * to the key itself so a value is never shown blank.
 */
export async function getFacets(scope: CatalogScope = {}): Promise<StorefrontFacets> {
  const facets = await mongoCatalogSearchPort.facets(scope);
  const options = await labelOptionFacets(facets.options);
  if (facets.attributes.length === 0) return { ...facets, attributes: [], options };

  const attributeKeys = facets.attributes.map((attribute) => attribute.key);
  const rows = await ProductModel.aggregate<LabelRow>([
    { $match: { lifecycle: "published", "attributes.key": { $in: attributeKeys } } },
    { $unwind: "$attributes" },
    { $match: { "attributes.key": { $in: attributeKeys } } },
    { $unwind: "$attributes.values" },
    { $group: { _id: { attributeKey: "$attributes.key", valueKey: "$attributes.values.key" }, name: { $first: "$attributes.name" }, label: { $first: "$attributes.values.value" } } },
  ]);

  const names = new Map<string, LocalizedString>();
  const labels = new Map<string, LocalizedString>();
  for (const row of rows) {
    names.set(row._id.attributeKey, row.name);
    labels.set(`${row._id.attributeKey}\u0000${row._id.valueKey}`, row.label);
  }

  return {
    ...facets,
    options,
    attributes: facets.attributes.map((attribute) => ({
      key: attribute.key,
      name: readable(names.get(attribute.key), attribute.key),
      values: attribute.values.map((value) => ({ key: value.key, label: readable(labels.get(`${attribute.key}\u0000${value.key}`), value.key), count: value.count })),
    })),
  };
}

/** A localized string with at least one non-blank locale, or the key in both. */
function readable(value: LocalizedString | undefined, fallback: string): LocalizedString {
  const hasText = value && Object.values(value).some((text) => typeof text === "string" && text.trim() !== "");
  return hasText ? value : ({ ar: fallback, en: fallback } as LocalizedString);
}

interface OptionLabelRow {
  _id: { axisKey: string; valueKey?: string | null };
  name: LocalizedString;
  label?: LocalizedString;
  position?: number | null;
}

/**
 * Names and value labels for the counted option axes, from the products' own
 * `optionAxes[]`. Values are ordered the way the merchant listed them (the
 * smallest position any product gives it), so sizes read S, M, L rather than
 * alphabetically; a value no axis defines a label for falls back to its key and
 * sorts last.
 */
async function labelOptionFacets(counted: CatalogFacets["options"]): Promise<StorefrontOptionFacet[]> {
  if (counted.length === 0) return [];

  const axisKeys = counted.map((axis) => axis.key);
  const rows = await ProductModel.aggregate<OptionLabelRow>([
    { $match: { lifecycle: "published", "optionAxes.key": { $in: axisKeys } } },
    { $unwind: "$optionAxes" },
    { $match: { "optionAxes.key": { $in: axisKeys } } },
    { $unwind: { path: "$optionAxes.values", includeArrayIndex: "position", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { axisKey: "$optionAxes.key", valueKey: "$optionAxes.values.key" },
        name: { $first: "$optionAxes.name" },
        label: { $first: "$optionAxes.values.label" },
        position: { $min: "$position" },
      },
    },
  ]);

  const names = new Map<string, LocalizedString>();
  const labels = new Map<string, LocalizedString>();
  const positions = new Map<string, number>();
  for (const row of rows) {
    if (!names.has(row._id.axisKey)) names.set(row._id.axisKey, row.name);
    if (row._id.valueKey && row.label) {
      const id = `${row._id.axisKey}\u0000${row._id.valueKey}`;
      labels.set(id, row.label);
      if (typeof row.position === "number") positions.set(id, row.position);
    }
  }

  return counted.map((axis) => ({
    key: axis.key,
    name: readable(names.get(axis.key), axis.key),
    values: axis.values
      .map((value) => {
        const id = `${axis.key}\u0000${value.key}`;
        return { key: value.key, label: readable(labels.get(id), value.key), count: value.count, position: positions.get(id) ?? Number.POSITIVE_INFINITY };
      })
      .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
      .map(({ position: _position, ...value }) => value),
  }));
}
