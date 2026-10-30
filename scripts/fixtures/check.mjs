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

/**
 * An image reference is either a bare name (a `.jpg` in this repo's own `scripts/fixtures/images`, the original form) or, when
 * it contains a "/", a path under the storefront's `public/` folder (`brandDir`, the sibling mimora-client checkout) that
 * carries its own real extension (`brand/mimora/categories/Gift-Boxes.jpeg`). One resolver for both the check and the seeder.
 */
const SUPPORTED_IMAGE_EXTS = new Set(["jpg", "jpeg", "png"]);

export function resolveImageRef(ref, { imageDir, brandDir }) {
  if (ref.includes("/")) {
    const ext = path.extname(ref).slice(1).toLowerCase();
    return { file: path.join(brandDir, ref), publicId: ref.replace(/\.[^.\/]+$/, ""), secureUrl: `/${ref}`, ext, format: ext === "jpeg" ? "jpg" : ext };
  }
  return { file: path.join(imageDir, `${ref}.jpg`), publicId: `preview/images/${ref}`, secureUrl: `/preview/images/${ref}.jpg`, ext: "jpg", format: "jpg" };
}

/**
 * `imageDir` enables the existence check for bare-name references, `brandDir` for path references; either may be omitted
 * (a job without that directory), in which case those references are not checked.
 */
export function checkFixture(f, { imageDir, brandDir } = {}) {
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

  const files = new Set();
  const collect = (v) => { if (typeof v === "string") files.add(v); };
  [f.store.logo, f.store.heroMedia, f.store.ogImage].forEach(collect);
  f.categories.forEach((x) => x.image && collect(x.image));
  f.collections.forEach((x) => x.image && collect(x.image));
  f.products.forEach((p) => { p.images.forEach(collect); p.variants.forEach((v) => (v.galleryOverride ?? []).forEach(collect)); });
  // The seeder reads dimensions for JPEG and PNG only; any other extension is refused here, with or without the files.
  for (const name of files) {
    if (name.includes("/") && !SUPPORTED_IMAGE_EXTS.has(path.extname(name).slice(1).toLowerCase())) out.push(`unsupported image type (jpg, jpeg or png only): ${name}`);
  }

  if (imageDir || brandDir) {
    for (const name of files) {
      if (name.includes("/") ? !brandDir : !imageDir) continue;
      const { file } = resolveImageRef(name, { imageDir, brandDir });
      if (!fs.existsSync(file)) out.push(`image file missing: ${name.includes("/") ? name : `${name}.jpg`}`);
    }
  }
  return out;
}

/** A mutation returns this when the fixture has nothing of the shape it breaks (e.g. no pages). The self-test says so per fixture. */
export const NOT_APPLICABLE = Symbol("not applicable");

/**
 * Each mutation must make `checkFixture` report something; otherwise the check cannot catch that class of fault.
 * A third element names what the mutation needs to be detectable (`imageFiles`: the fixture image directory; `brandFiles`: the
 * storefront `public/` directory that holds `brand/...` images).
 */
export const MUTATIONS = [
  ["variant removed from a product", (f) => { f.products[0].variants = []; }],
  ["variant option key that is not an axis", (f) => { const p = f.products.find((x) => x.axes.length); if (!p) return NOT_APPLICABLE; p.variants[0].optionValues[0].key = "bogus"; }],
  ["variant option value not on the axis", (f) => { const p = f.products.find((x) => x.axes.length); if (!p) return NOT_APPLICABLE; p.variants[0].optionValues[0].value = "no-such-value"; }],
  ["axis-less product given an option value", (f) => { const p = f.products.find((x) => !x.axes.length); if (!p) return NOT_APPLICABLE; p.variants[0].optionValues = [{ key: "size", value: "M" }]; }],
  ["duplicate product slug", (f) => { f.products[1].slug = f.products[0].slug; }],
  ["duplicate SKU", (f) => { f.products[1].variants[0].sku = f.products[0].variants[0].sku; }],
  ["missing Arabic on a product name", (f) => { delete f.products[0].name.ar; }],
  ["blank English on a page title", (f) => { if (!f.pages.length) return NOT_APPLICABLE; f.pages[0].title.en = " "; }],
  ["missing locale inside a payment instruction", (f) => { f.payments.methods.at(-1).instructions = { en: "only english" }; }],
  ["navigation to a page that does not exist", (f) => { if (!f.content.footerNavigation.length) return NOT_APPLICABLE; f.content.footerNavigation[0].target.slug = "nope"; }],
  ["header navigation to a category that does not exist", (f) => { f.content.headerNavigation[0].target.slug = "nope"; }],
  ["product in an unknown category", (f) => { f.products[0].category = "nope"; }],
  ["image file that does not exist", (f) => { f.products.find((p) => p.images.length).images[0] = "no-such-image"; }, "imageFiles"],
  ["public-path image with an unsupported type", (f) => { f.products.find((p) => p.images.length).images[0] = "brand/none/photo.webp"; }],
  ["public-path image (with its own extension) that does not exist", (f) => { f.products.find((p) => p.images.length).images[0] = "brand/none/missing.jpeg"; }, "brandFiles"],
];
