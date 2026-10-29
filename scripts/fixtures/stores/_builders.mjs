// Small pure helpers shared by the fixture modules. No I/O, no network: a fixture module is plain data.

/** A localized string. */
export const L = (en, ar) => ({ en, ar });

/** Stock rule shared by the fixtures: plenty, none, or below the store's default low-stock threshold (5). */
export const OK = 25;
export const OUT = 0;
export const LOW = 2;

/** An option axis. `values` are `[key, en, ar, swatch?]` tuples; swatch is `#RRGGBB`. */
export const axis = (key, nameEn, nameAr, values) => ({
  key,
  name: L(nameEn, nameAr),
  values: values.map(([k, en, ar, swatch]) => ({ key: k, label: L(en, ar), ...(swatch ? { swatch } : {}) })),
});

/** A size-like axis whose labels equal its keys (S, M, 40, ...). */
export const plainAxis = (key, nameEn, nameAr, keys) => axis(key, nameEn, nameAr, keys.map((k) => [k, k, k]));

/** Every combination of `[axisKey, [valueKeys]]` lists. */
export const cross = (axes) => axes.reduce((acc, [k, vals]) => acc.flatMap((c) => vals.map((v) => ({ ...c, [k]: v }))), [{}]);

export const sku = (prefix, combo) => [prefix, ...Object.values(combo).map((v) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))].join("-");

/** One variant per combination. `o.notMade/soldOut/low/gallery` are predicates over a combination. */
export const mk = (prefix, combos, price, o = {}) =>
  combos
    .filter((c) => !o.notMade?.(c))
    .map((c) => ({
      sku: sku(prefix, c),
      optionValues: Object.entries(c).map(([key, value]) => ({ key, value })),
      price: typeof price === "function" ? price(c) : price,
      ...(o.compareAt ? { compareAtPrice: typeof o.compareAt === "function" ? o.compareAt(c) : o.compareAt } : {}),
      stock: o.soldOut?.(c) ? OUT : o.low?.(c) ? LOW : OK,
      ...(o.gallery?.(c) ? { galleryOverride: o.gallery(c) } : {}),
    }));

/** A product with no option axes: exactly one variant with no option values. */
export const single = (s, price, stock = OK, extra = {}) => [{ sku: s, optionValues: [], price, stock, ...extra }];

/** A spec row (admin "attributes"); `key` is derived from the English name. */
export const spec = (en, ar, valueEn, valueAr) => ({
  key: en.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "").slice(0, 50),
  name: L(en, ar),
  values: [{ key: "v", value: L(valueEn, valueAr) }],
});
