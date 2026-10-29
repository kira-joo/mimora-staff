// Structural validation of a fixture module. Pure: no network, no database. Returns a list of violation strings.
import fs from "node:fs";
import path from "node:path";

const MONEY = /^\d+(\.\d{1,2})?$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Every object with an `en` or `ar` key (a localized string) must carry both, as non-empty strings. */
function walkLocalized(node, where, out) {
  if (Array.isArray(node)) return node.forEach((v, i) => walkLocalized(v, `${where}[${i}]`, out));
  if (!node || typeof node !== "object") return;
  if ("en" in node || "ar" in node) {
    for (const lang of ["en", "ar"]) {
      if (typeof node[lang] !== "string" || !node[lang].trim()) out.push(`${where}: localized field missing or empty "${lang}"`);
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) walkLocalized(v, `${where}.${k}`, out);
}

function dupes(label, values, out) {
  const seen = new Set();
  for (const v of values) {
    if (seen.has(v)) out.push(`duplicate ${label}: ${v}`);
    seen.add(v);
  }
}

export function checkFixture(f, { imageDir } = {}) {
  const out = [];
  const where = f.key ?? "fixture";
  walkLocalized(f, where, out);

  dupes("product slug", f.products.map((p) => p.slug), out);
  dupes("category slug", f.categories.map((c) => c.slug), out);
  dupes("collection slug", f.collections.map((c) => c.slug), out);
  dupes("brand slug", f.brands.map((b) => b.slug), out);
  dupes("page slug", f.pages.map((p) => p.slug), out);
  dupes("SKU", f.products.flatMap((p) => p.variants.map((v) => v.sku)), out);

  const cats = new Set(f.categories.map((c) => c.slug));
  const cols = new Set(f.collections.map((c) => c.slug));
  const brands = new Set(f.brands.map((b) => b.slug));
  const pages = new Set(f.pages.map((p) => p.slug));

  for (const c of f.categories) if (c.parent && !cats.has(c.parent)) out.push(`category ${c.slug}: unknown parent ${c.parent}`);

  for (const p of f.products) {
    const at = `product ${p.slug}`;
    if (!cats.has(p.category)) out.push(`${at}: unknown category ${p.category}`);
    for (const c of p.collections ?? []) if (!cols.has(c)) out.push(`${at}: unknown collection ${c}`);
    if (p.brand && !brands.has(p.brand)) out.push(`${at}: unknown brand ${p.brand}`);
    if (p.sizeGuide !== undefined && !f.sizeGuides[p.sizeGuide]) out.push(`${at}: sizeGuide index ${p.sizeGuide} out of range`);
    if (!p.variants?.length) { out.push(`${at}: has no variants`); continue; }

    dupes(`${at} axis key`, p.axes.map((a) => a.key), out);
    const axisValues = new Map(p.axes.map((a) => [a.key, new Set(a.values.map((v) => v.key))]));
    for (const a of p.axes) {
      dupes(`${at} axis ${a.key} value key`, a.values.map((v) => v.key), out);
      if (!a.values.length) out.push(`${at}: axis ${a.key} has no values`);
      for (const v of a.values) if (v.swatch !== undefined && !HEX.test(v.swatch)) out.push(`${at}: axis ${a.key} value ${v.key} swatch is not #RRGGBB`);
    }
    const combos = [];
    for (const v of p.variants) {
      const vt = `${at} variant ${v.sku}`;
      const keys = v.optionValues.map((o) => o.key);
      if (new Set(keys).size !== keys.length) out.push(`${vt}: repeats an option key`);
      const want = [...axisValues.keys()].sort().join(",");
      if ([...new Set(keys)].sort().join(",") !== want) out.push(`${vt}: optionValues keys [${keys}] do not match product axes [${want}]`);
      for (const o of v.optionValues) {
        const vals = axisValues.get(o.key);
        if (vals && !vals.has(o.value)) out.push(`${vt}: value "${o.value}" is not a value of axis ${o.key}`);
      }
      combos.push(JSON.stringify([...v.optionValues].sort((a, b) => a.key.localeCompare(b.key))));
      if (!MONEY.test(v.price)) out.push(`${vt}: bad price ${v.price}`);
      if (v.compareAtPrice !== undefined && !MONEY.test(v.compareAtPrice)) out.push(`${vt}: bad compareAtPrice`);
      if (v.compareAtPrice !== undefined && Number(v.compareAtPrice) <= Number(v.price)) out.push(`${vt}: compareAtPrice is not above price`);
      if (!Number.isInteger(v.stock) || v.stock < 0) out.push(`${vt}: bad stock ${v.stock}`);
    }
    dupes(`${at} option combination`, combos, out);
  }

  const target = (t, at) => {
    const set = { category: cats, collection: cols, page: pages }[t.kind];
    if (!set) out.push(`${at}: unknown link kind ${t.kind}`);
    else if (!set.has(t.slug)) out.push(`${at}: unknown ${t.kind} ${t.slug}`);
  };
  const c = f.content;
  for (const a of c.announcements) if (a.target) target(a.target, "announcement");
  for (const n of [...c.headerNavigation, ...c.footerNavigation]) target(n.target, "navigation item");
  if (c.homeSections[0]?.type !== "campaignHero") out.push("home sections must start with a campaignHero");
  for (const s of c.homeSections) {
    if (s.target) target(s.target, `home section ${s.type}`);
    for (const slug of s.categories ?? []) if (!cats.has(slug)) out.push(`home section ${s.type}: unknown category ${slug}`);
    if (s.collection && !cols.has(s.collection)) out.push(`home section ${s.type}: unknown collection ${s.collection}`);
    if (s.type === "productRail" && (s.source === "collection") !== Boolean(s.collection)) out.push("productRail: collection must be set exactly when source is collection");
  }

  if (imageDir) {
    const files = new Set();
    const collect = (v) => { if (typeof v === "string") files.add(v); };
    [f.store.heroMedia, f.store.ogImage].forEach(collect);
    f.categories.forEach((x) => x.image && collect(x.image));
    f.collections.forEach((x) => x.image && collect(x.image));
    f.products.forEach((p) => { p.images.forEach(collect); p.variants.forEach((v) => (v.galleryOverride ?? []).forEach(collect)); });
    for (const name of files) if (!fs.existsSync(path.join(imageDir, `${name}.jpg`))) out.push(`image file missing: ${name}.jpg`);
  }
  return out;
}

/**
 * Each mutation must make `checkFixture` report something; otherwise the check cannot catch that class of fault.
 * A third element names what the mutation needs to be detectable (`imageFiles`: an image directory).
 */
export const MUTATIONS = [
  ["variant removed from a product", (f) => { f.products[0].variants = []; }],
  ["variant option key that is not an axis", (f) => { const v = f.products.find((p) => p.axes.length).variants[0]; v.optionValues[0].key = "bogus"; }],
  ["variant option value not on the axis", (f) => { const v = f.products.find((p) => p.axes.length).variants[0]; v.optionValues[0].value = "no-such-value"; }],
  ["axis-less product given an option value", (f) => { f.products.find((p) => !p.axes.length).variants[0].optionValues = [{ key: "size", value: "M" }]; }],
  ["duplicate product slug", (f) => { f.products[1].slug = f.products[0].slug; }],
  ["duplicate SKU", (f) => { f.products[1].variants[0].sku = f.products[0].variants[0].sku; }],
  ["missing Arabic on a product name", (f) => { delete f.products[0].name.ar; }],
  ["blank English on a page title", (f) => { f.pages[0].title.en = " "; }],
  ["missing locale inside a payment instruction", (f) => { f.payments.methods.at(-1).instructions = { en: "only english" }; }],
  ["navigation to a page that does not exist", (f) => { f.content.footerNavigation[0].target.slug = "nope"; }],
  ["product in an unknown category", (f) => { f.products[0].category = "nope"; }],
  ["image file that does not exist", (f) => { f.products.find((p) => p.images.length).images[0] = "no-such-image"; }, "imageFiles"],
];
