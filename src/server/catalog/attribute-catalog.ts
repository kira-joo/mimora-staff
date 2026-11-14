/**
 * The attribute catalog is DERIVED, never stored: attributes live embedded on each product, and the storefront filters
 * by KEY. This folds every product's attributes into one entry per key so staff can pick an existing attribute instead of
 * typing a new spelling of it. Pure — the database read lives in `attribute-catalog-store.ts`.
 */

export interface LocalizedPair {
  en: string;
  ar: string;
}

export interface AttributeCatalogValue {
  key: string;
  /** The most frequent label for this value (ties: lowest en, then ar). */
  value: LocalizedPair;
  productCount: number;
}

export interface AttributeCatalogEntry {
  key: string;
  /** The most frequent name for this key (ties: lowest en, then ar). */
  name: LocalizedPair;
  /** Every distinct name pair products use for this key, most used first, the chosen name included. More than one means the catalog already disagrees with itself. */
  nameVariants: LocalizedPair[];
  productCount: number;
  values: AttributeCatalogValue[];
}

/** The part of a product the catalog reads. */
export interface CatalogProductRow {
  attributes?: Array<{ key: string; name: LocalizedPair; values?: Array<{ key: string; value: LocalizedPair }> }> | null;
}

const text = (value: string | undefined | null) => value ?? "";
const pairId = (pair: LocalizedPair) => `${text(pair.en)}\u0000${text(pair.ar)}`;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pair → how many products use it. */
class PairTally {
  private readonly counts = new Map<string, { pair: LocalizedPair; count: number }>();
  add(pair: LocalizedPair) {
    const normalized = { en: text(pair.en), ar: text(pair.ar) };
    const id = pairId(normalized);
    const existing = this.counts.get(id);
    if (existing) existing.count += 1;
    else this.counts.set(id, { pair: normalized, count: 1 });
  }
  /** Most used first; ties by en then ar ascending, so the winner never depends on read order. */
  ranked(): LocalizedPair[] {
    return [...this.counts.values()].sort((a, b) => b.count - a.count || compareText(a.pair.en, b.pair.en) || compareText(a.pair.ar, b.pair.ar)).map((entry) => entry.pair);
  }
}

const sortLabel = (entry: { key: string; label: LocalizedPair }) => (entry.label.en || entry.label.ar || entry.key).toLowerCase();

export function buildAttributeCatalog(products: readonly CatalogProductRow[]): AttributeCatalogEntry[] {
  const byKey = new Map<string, { names: PairTally; productCount: number; values: Map<string, { labels: PairTally; productCount: number }> }>();

  for (const product of products) {
    const seenAttributes = new Set<string>();
    for (const attribute of product.attributes ?? []) {
      if (!attribute.key || seenAttributes.has(attribute.key)) continue; // a product counts once per key
      seenAttributes.add(attribute.key);
      let entry = byKey.get(attribute.key);
      if (!entry) byKey.set(attribute.key, (entry = { names: new PairTally(), productCount: 0, values: new Map() }));
      entry.productCount += 1;
      entry.names.add(attribute.name);

      const seenValues = new Set<string>();
      for (const value of attribute.values ?? []) {
        if (!value.key || seenValues.has(value.key)) continue;
        seenValues.add(value.key);
        let tally = entry.values.get(value.key);
        if (!tally) entry.values.set(value.key, (tally = { labels: new PairTally(), productCount: 0 }));
        tally.productCount += 1;
        tally.labels.add(value.value);
      }
    }
  }

  return [...byKey.entries()]
    .map(([key, entry]): AttributeCatalogEntry => {
      const variants = entry.names.ranked();
      return {
        key,
        name: variants[0]!,
        nameVariants: variants,
        productCount: entry.productCount,
        values: [...entry.values.entries()]
          .map(([valueKey, tally]): AttributeCatalogValue => ({ key: valueKey, value: tally.labels.ranked()[0]!, productCount: tally.productCount }))
          .sort((a, b) => compareText(sortLabel({ key: a.key, label: a.value }), sortLabel({ key: b.key, label: b.value })) || compareText(a.key, b.key)),
      };
    })
    .sort((a, b) => compareText(sortLabel({ key: a.key, label: a.name }), sortLabel({ key: b.key, label: b.name })) || compareText(a.key, b.key));
}
