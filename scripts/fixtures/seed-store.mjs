// Idempotent fixture seeder for mimora-staff. Admin HTTP API only, plus one direct write: the first owner.
//
//   node scripts/fixtures/seed-store.mjs --store ci-default|ci-alternate|mimora [--confirm-db <MONGODB_DB>]
//   node scripts/fixtures/seed-store.mjs --check [--self-test] [--no-image-files]   (no server, no database)
//
// Env: BACKEND_URL (default http://localhost:3040), MONGODB_URI, MONGODB_DB, OWNER_EMAIL, OWNER_PASSWORD,
//      FIXTURE_IMAGE_DIR (optional, default scripts/fixtures/images, this repo's own CI fixture photos),
//      FIXTURE_BRAND_DIR (optional, the storefront's public/ folder that holds the `brand/...` images; default
//      ../mimora-client/public, the sibling checkout), FIXTURE_MANIFEST_OUT (optional path for the manifest JSON).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { checkFixture, resolveImageRef, MUTATIONS, NOT_APPLICABLE } from "./check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = process.env.FIXTURE_IMAGE_DIR ?? path.resolve(HERE, "images");
// Seeding only READS these files (size and dimensions go into the image record); nothing is uploaded. The storefront serves
// the same files itself from its public/ folder, which is why the stored secureUrl is root-relative.
const BRAND_DIR = process.env.FIXTURE_BRAND_DIR ?? path.resolve(HERE, "../../../mimora-client/public");
// key -> [module, export]. The two CI profiles are one fictional shop (stores/ci-gift-shop.mjs) in two settings profiles.
const STORES = { "ci-default": ["./stores/ci-gift-shop.mjs", "ciDefault"], "ci-alternate": ["./stores/ci-gift-shop.mjs", "ciAlternate"], mimora: ["./stores/mimora.mjs", "default"] };
const log = (...a) => console.log(...a);

async function loadStore(key) {
  if (!Object.hasOwn(STORES, key ?? "")) throw new Error(`Unknown --store "${key}". Valid stores: ${Object.keys(STORES).join(", ")}`);
  const [file, name] = STORES[key];
  return (await import(file))[name];
}

/* ------------------------------------------------------------------ --check */
async function runCheck(selfTest, checkImages) {
  let failed = false;
  // CI fixture photos live in this repo (scripts/fixtures/images) and are always checked. The mimora `brand/...` images
  // live in the sibling mimora-client checkout; a job holding only this repo (mimora-staff's own CI) cannot see them, so it
  // says so — loudly — instead of reporting every image missing. They are still proven where both repos are present:
  // seeding reads every one.
  const imageDir = checkImages ? IMG_DIR : undefined;
  const brandAvailable = checkImages && fs.existsSync(path.join(BRAND_DIR, "brand"));
  const brandDir = brandAvailable ? BRAND_DIR : undefined;
  if (!checkImages) log("check: image files NOT checked (--no-image-files)");
  else if (!brandAvailable) log(`check: brand/... image files NOT checked — no ${path.join(BRAND_DIR, "brand")} (set FIXTURE_BRAND_DIR or check out mimora-client beside this repo); seeding verifies them`);
  for (const key of Object.keys(STORES)) {
    const f = await loadStore(key);
    const v = checkFixture(f, { imageDir, brandDir });
    log(`check ${key}: ${v.length === 0 ? "OK" : `${v.length} violation(s)`}`);
    v.forEach((x) => log(`  - ${x}`));
    if (v.length) failed = true;
  }
  if (selfTest) {
    // Prove the check can fail: break a deep copy in memory and require that every break is reported.
    for (const key of Object.keys(STORES)) {
      const original = await loadStore(key);
      for (const [name, mutate, needs] of MUTATIONS) {
        if ((needs === "imageFiles" && !imageDir) || (needs === "brandFiles" && !brandDir)) { log(`self-test ${key} :: ${name}: skipped (needs ${needs === "brandFiles" ? "brand image files" : "image files"})`); continue; }
        const copy = structuredClone(original);
        if (mutate(copy) === NOT_APPLICABLE) { log(`self-test ${key} :: ${name}: skipped (fixture has nothing of that shape)`); continue; }
        const v = checkFixture(copy, { imageDir, brandDir });
        const caught = v.length > 0;
        log(`self-test ${key} :: ${name}: ${caught ? `caught (${v[0]})` : "NOT CAUGHT"}`);
        if (!caught) failed = true;
      }
      if (checkFixture(original, { imageDir, brandDir }).length) failed = true; // mutations must not have leaked into the original
    }
    log(`self-test ${failed ? "FAILED" : "passed"}: every mutation was reported`);
  }
  process.exit(failed ? 1 : 0);
}

/* ------------------------------------------------------------------ safety guards */
function hostsOfMongoUri(uri) {
  const m = /^mongodb:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
  if (!m) throw new Error("MONGODB_URI must be a plain mongodb:// URI (mongodb+srv is never a local fixture target)");
  return m[1].split(",").map((h) => h.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase());
}
function hostAllowed(host) {
  if (["localhost", "127.0.0.1", "::1"].includes(host)) return true;
  // Service names (single label, e.g. `mongodb`, `backend`) are reachable only inside a CI network.
  return process.env.CI === "true" && /^[a-z0-9_-]+$/.test(host);
}
/**
 * `confirmDb` (`--confirm-db <name>`) is the one explicit opt-in for a database whose name does not carry the -dev / -test /
 * store-fixture- marker (a local database an owner wants filled with sample content). It must equal MONGODB_DB exactly, so it
 * cannot be set once and forgotten; every other guard, including the localhost-only hosts, still applies.
 */
function guard(env, confirmDb) {
  const problems = [];
  let backendHost = "";
  try { backendHost = new URL(env.BACKEND_URL).hostname.replace(/^\[|\]$/g, ""); } catch { problems.push("BACKEND_URL is not a valid URL"); }
  if (backendHost && !hostAllowed(backendHost)) problems.push(`BACKEND_URL host "${backendHost}" is not localhost/127.0.0.1${process.env.CI === "true" ? " or a CI service name" : ""}`);
  try {
    for (const h of hostsOfMongoUri(env.MONGODB_URI)) if (!hostAllowed(h)) problems.push(`MONGODB_URI host "${h}" is not localhost/127.0.0.1${process.env.CI === "true" ? " or a CI service name" : ""}`);
  } catch (e) { problems.push(e.message); }
  const db = env.MONGODB_DB ?? "";
  if (!db) problems.push("MONGODB_DB is required");
  else if (confirmDb !== undefined && confirmDb !== db) problems.push(`--confirm-db "${confirmDb}" must equal MONGODB_DB "${db}" exactly`);
  else if (!(db.endsWith("-dev") || db.endsWith("-test") || db.startsWith("store-fixture-") || confirmDb === db)) problems.push(`MONGODB_DB "${db}" must end in -dev or -test, or start with store-fixture- (or be named explicitly with --confirm-db ${db})`);
  if (!env.OWNER_EMAIL) problems.push("OWNER_EMAIL is required");
  if (!env.OWNER_PASSWORD) problems.push("OWNER_PASSWORD is required");
  else if (env.OWNER_PASSWORD.length < 10) problems.push("OWNER_PASSWORD must be at least 10 characters (the accept-invite DTO enforces it)");
  if (problems.length) throw new Error("Refusing to run (no writes were made):\n  - " + problems.join("\n  - "));
}

/* ------------------------------------------------------------------ http */
class Http {
  constructor(base, cookieFile) {
    this.base = base.replace(/\/$/, "");
    this.cookieFile = cookieFile;
    this.cookies = new Map();
    try { for (const [k, v] of JSON.parse(fs.readFileSync(cookieFile, "utf8"))) this.cookies.set(k, v); } catch { /* none yet */ }
  }
  absorb(res) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(sc)) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    // Refresh tokens rotate, so the newest jar must survive the process. Owner-only file, keyed by database name.
    fs.writeFileSync(this.cookieFile, JSON.stringify([...this.cookies]), { mode: 0o600 });
    fs.chmodSync(this.cookieFile, 0o600);
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  async refresh() {
    if (!this.cookies.has("store_staff_refresh")) return false;
    const res = await fetch(`${this.base}/api/admin/auth/token/refresh`, { method: "POST", headers: { cookie: `store_staff_refresh=${this.cookies.get("store_staff_refresh")}` } });
    if (!res.ok) return false;
    this.absorb(res);
    return true;
  }
  async login(email, password) {
    if (await this.refresh()) return;
    const res = await fetch(`${this.base}/api/admin/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    // The body carries the password, so it is never echoed in an error.
    if (!res.ok) throw new Error(`POST /api/admin/auth/login -> ${res.status}\n  response: ${await res.text()}`);
    this.absorb(res);
  }
  async admin(method, p, body, retried = false) {
    const res = await fetch(`${this.base}/api/admin${p}`, { method, headers: { "content-type": "application/json", cookie: this.header() }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401 && !retried) { await this.login(this.email, this.password); return this.admin(method, p, body, true); }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} /api/admin${p} -> ${res.status}\n  body: ${JSON.stringify(body)?.slice(0, 600)}\n  response: ${text}`);
    this.absorb(res);
    return text ? JSON.parse(text) : null;
  }
  async listAll(p) {
    const sep = p.includes("?") ? "&" : "?";
    const out = [];
    for (let page = 1; ; page++) {
      const r = await this.admin("GET", `${p}${sep}limit=100&page=${page}`);
      out.push(...r.data);
      if (page >= r.totalPages) break;
    }
    return out;
  }
  /** Public, unauthenticated read. `null` on 404; any other non-2xx throws with method, path, status and body. */
  async pub(p) {
    const res = await fetch(`${this.base}/api/storefront${p}`);
    const text = await res.text();
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET /api/storefront${p} -> ${res.status}\n  response: ${text}`);
    return text ? JSON.parse(text) : null;
  }
}

/* ------------------------------------------------------------------ owner bootstrap */
/** No code path creates a first owner, so the fixture writes one staffusers row (invited, no password) and lets the real
 *  accept-invite endpoint set the password. Only the SHA-256 of a one-time token is stored, as the invite flow does. */
async function ensureOwner(env, http) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db(env.MONGODB_DB);
    const role = await db.collection("roles").findOne({ name: "Owner" });
    if (!role) throw new Error(`No "Owner" role in database "${env.MONGODB_DB}". Boot the backend against this database once (MONGODB_DB=${env.MONGODB_DB}) so it seeds its default roles, then re-run.`);
    const email = env.OWNER_EMAIL.trim().toLowerCase();
    const users = db.collection("staffusers");
    const existing = await users.findOne({ email }, { projection: { passwordHash: 1 } });
    if (existing?.passwordHash) { log(`owner ${email} already exists with a password; skipping bootstrap`); return; }

    const token = crypto.randomBytes(32).toString("hex");
    const fields = { passwordResetTokenHash: crypto.createHash("sha256").update(token).digest("hex"), passwordResetExpiresAt: new Date(Date.now() + 3600_000), updatedAt: new Date() };
    if (existing) await users.updateOne({ _id: existing._id }, { $set: fields });
    else {
      const now = new Date();
      await users.insertOne({ email, name: "Fixture Owner", roles: [role._id], active: true, tokenVersion: 1, ...fields, createdAt: now, updatedAt: now });
    }
    const res = await fetch(`${http.base}/api/admin/auth/accept-invite`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: env.OWNER_PASSWORD }) });
    if (!res.ok) throw new Error(`POST /api/admin/auth/accept-invite -> ${res.status}\n  response: ${await res.text()}`);
    log(`owner ${email} bootstrapped (password set through accept-invite, length ${env.OWNER_PASSWORD.length})`);
  } finally {
    await client.close();
  }
}

/* ------------------------------------------------------------------ images */
function pngSize(buf) {
  if (buf.toString("latin1", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("no SOF marker");
}
/** The storefront serves its /public folder itself, so a root-relative secureUrl is enough; no upload service is involved. */
function img(ref) {
  const r = resolveImageRef(ref, { imageDir: IMG_DIR, brandDir: BRAND_DIR });
  const buf = fs.readFileSync(r.file);
  const { width, height } = r.ext === "png" ? pngSize(buf) : jpegSize(buf);
  return { provider: "cloudinary", publicId: r.publicId, secureUrl: r.secureUrl, format: r.format, width, height, bytes: buf.length };
}

/* ------------------------------------------------------------------ seeding */
const canon = (v) => JSON.stringify(v, (k, x) => (["_id", "id"].includes(k) ? undefined : x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const L = (en, ar) => ({ en, ar });

async function upsert(http, label, listPath, match, body) {
  const existing = (await http.listAll(listPath)).find(match);
  if (existing) {
    const r = await http.admin("PUT", `${listPath}/${existing._id}`, body);
    log(`  updated ${label}`);
    return { ...existing, ...r, _id: existing._id };
  }
  const r = await http.admin("POST", listPath, body);
  log(`  created ${label}`);
  return r;
}

async function seed(f, http) {
  const storeName = f.store.name;
  const seoOf = (name, desc) => ({ seoTitle: L(`${name.en} | ${storeName.en}`, `${name.ar} | ${storeName.ar}`), seoDescription: desc });
  const image = (name) => (name ? img(name) : undefined);

  log("[store profile]");
  await http.admin("PUT", "/store-profile", { ...f.store, logo: image(f.store.logo), heroMedia: image(f.store.heroMedia), ogImage: image(f.store.ogImage), defaultSeo: f.store.defaultSeo });
  log("[theme]");
  await http.admin("PUT", "/store-profile/theme", f.theme);
  log("[fulfilment settings]");
  await http.admin("PUT", "/fulfilment-settings", f.fulfilment);
  log("[operating hours]");
  if (f.hours) await http.admin("PUT", "/operating-hours", f.hours);
  else log("  none for this store");
  log("[payment settings]");
  await http.admin("PUT", "/payment-settings", f.payments);

  log("[delivery zones]");
  for (const z of f.zones) await upsert(http, `zone ${z.name.en}`, "/delivery-zones", (x) => x.name.en === z.name.en, z);
  log("[pickup locations]");
  for (const p of f.pickups) await upsert(http, `pickup ${p.name.en}`, "/pickup-locations", (x) => x.name.en === p.name.en, p);
  if (!f.pickups.length) log("  none for this store");

  log("[brands]");
  const brandId = {};
  for (const b of f.brands) brandId[b.slug] = (await upsert(http, `brand ${b.slug}`, "/brands", (x) => x.slug === b.slug, { ...b, published: true }))._id;

  log("[categories]");
  const catId = {};
  for (const c of [...f.categories].sort((a, b) => Number(!!a.parent) - Number(!!b.parent))) {
    const body = { slug: c.slug, name: c.name, description: c.description, ...(c.parent ? { parentId: catId[c.parent] } : {}), sortOrder: f.categories.indexOf(c), ...(c.image ? { image: img(c.image) } : {}), ...seoOf(c.name, c.description), published: true };
    catId[c.slug] = (await upsert(http, `category ${c.slug}`, "/categories", (x) => x.slug === c.slug, body))._id;
  }

  log("[collections]");
  const colId = {};
  for (const c of f.collections) {
    const body = { slug: c.slug, name: c.name, description: c.description, sortOrder: f.collections.indexOf(c), image: img(c.image), ...seoOf(c.name, c.description), published: true };
    colId[c.slug] = (await upsert(http, `collection ${c.slug}`, "/collections", (x) => x.slug === c.slug, body))._id;
  }

  log("[size guides]");
  const sgId = [];
  for (const g of f.sizeGuides) sgId.push((await upsert(http, `size guide ${g.name.en}`, "/size-guides", (x) => x.name.en === g.name.en, g))._id);
  if (!f.sizeGuides.length) log("  none for this store");

  log("[products + variants]");
  for (const [index, p] of f.products.entries()) {
    const body = {
      name: p.name, description: p.description, slug: p.slug, categoryId: catId[p.category], collectionIds: p.collections.map((s) => colId[s]),
      ...(p.brand ? { brandId: brandId[p.brand] } : {}), ...(p.sizeGuide !== undefined ? { sizeGuide: sgId[p.sizeGuide] } : {}),
      images: p.images.map(img), optionAxes: p.axes, attributes: p.specs,
      seoTitle: L(`${p.name.en} | ${storeName.en}`, `${p.name.ar} | ${storeName.ar}`), seoDescription: L(p.description.en.slice(0, 150), p.description.ar.slice(0, 150)), order: index,
    };
    const existing = (await http.listAll("/products")).find((x) => x.slug === p.slug);
    let product;
    if (existing) {
      const upd = { ...body };
      // Backend quirk: PUT /products/:id re-validates embedded image assets and rejects every field of an unchanged,
      // valid asset (create accepts them). Send images only when they actually differ.
      const urls = (a) => (a ?? []).map((i) => i.secureUrl).join("|");
      const full = await http.admin("GET", `/products/${existing._id}`);
      if (urls(full.images) === urls(body.images)) delete upd.images;
      product = await http.admin("PUT", `/products/${existing._id}`, upd);
      product._id = existing._id;
      log(`  updated product ${p.slug}`);
    } else {
      product = await http.admin("POST", "/products", { ...body, lifecycle: "draft" });
      log(`  created product ${p.slug}`);
    }
    const have = await http.listAll(`/variants?productId=${product._id}`);
    for (const v of p.variants) {
      const wire = { ...v, ...(v.galleryOverride ? { galleryOverride: v.galleryOverride.map(img) } : {}) };
      const cur = have.find((h) => h.sku === v.sku);
      if (cur) {
        // `stock` is create-only on the variant API (PUT rejects it: "property stock should not exist"); stock is
        // changed only by a stock movement. Re-set it to the fixture value through the inventory adjustment API, which
        // leaves an auditable movement and does nothing when it already matches (so a second run is a no-op).
        const { stock, ...updatable } = wire;
        await http.admin("PUT", `/variants/${cur._id}`, updatable);
        const delta = stock - cur.stock;
        if (delta !== 0) await http.admin("PUT", `/inventory/${cur._id}/adjust`, { delta, reason: "ADJUSTMENT", note: "Fixture re-seed: stock reset to the fixture value" });
      } else await http.admin("POST", "/variants", { productId: product._id, ...wire });
    }
    log(`    ${p.variants.length} variants synced (${have.length} existed)`);
    const current = (await http.admin("GET", `/products/${product._id}`)).lifecycle;
    if (current !== "published") { await http.admin("PUT", `/products/${product._id}/lifecycle`, { lifecycle: "published" }); log(`    published ${p.slug}`); }
  }

  log("[pages]");
  const pageId = {};
  for (const pg of f.pages) {
    const body = { ...pg, published: true, seo: { title: L(`${pg.title.en} | ${storeName.en}`, `${pg.title.ar} | ${storeName.ar}`), description: L(pg.title.en, pg.title.ar) } };
    pageId[pg.slug] = (await upsert(http, `page ${pg.slug}`, "/pages", (x) => x.slug === pg.slug, body))._id;
  }

  log("[promotions]");
  for (const pr of f.promotions) await upsert(http, `promotion ${pr.code ?? pr.name.en}`, "/promotions", pr.code ? (x) => x.code === pr.code : (x) => !x.code && x.name?.en === pr.name.en, pr);

  log("[storefront content]");
  const ids = { category: catId, collection: colId, page: pageId };
  const tgt = (t) => ({ kind: t.kind, id: ids[t.kind][t.slug] });
  const withTarget = (o) => ({ ...o, ...(o.target ? { target: tgt(o.target) } : {}) });
  const desired = {
    announcements: f.content.announcements.map(withTarget),
    headerNavigation: f.content.headerNavigation.map(withTarget),
    footerNavigation: f.content.footerNavigation.map(withTarget),
    homeSections: f.content.homeSections.map((s) => {
      const { categories, collection, ...rest } = withTarget(s);
      return { ...rest, ...(categories ? { categoryIds: categories.map((c) => catId[c]) } : {}), ...(collection ? { collectionId: colId[collection] } : {}) };
    }),
  };
  const cur = await http.admin("GET", "/storefront-content");
  if (cur.draft && canon(cur.draft) === canon(desired) && !cur.hasUnpublishedChanges && cur.published) log("  draft already equals desired and is published; skipped");
  else {
    const saved = await http.admin("PUT", "/storefront-content", desired);
    const rev = saved.draftRevision ?? (await http.admin("GET", "/storefront-content")).draftRevision;
    await http.admin("PUT", "/storefront-content/publish", { draftRevision: rev });
    log(`  saved draft and published revision ${rev}`);
  }
}

/* ------------------------------------------------------------------ manifest (read back from the PUBLIC api) */
async function manifest(f, http) {
  const [profile, theme, fulfilment, methods, categories, collections, list] = await Promise.all([
    http.pub("/store-profile"), http.pub("/theme"), http.pub("/fulfilment-settings"), http.pub("/payment-methods"),
    http.pub("/categories"), http.pub("/collections"), http.pub("/products?limit=100"),
  ]);
  const details = [];
  for (const p of list.data) details.push({ p, d: await http.pub(`/products/${p.slug}`) });
  const slugs = (pred) => details.filter(({ p, d }) => pred(p, d)).map(({ p }) => p.slug);
  const purchasable = (d) => d.variants.some((v) => v.purchasable);
  const firstWithProducts = (items, key) => items.slice().sort((a, b) => a.sortOrder - b.sortOrder).find((c) => details.some(({ p }) => (key === "category" ? p.categoryId === c._id : (p.collectionIds ?? []).includes(c._id))))?.slug ?? null;
  let pageSlug = null;
  for (const pg of f.pages) if (await http.pub(`/pages/${pg.slug}`)) { pageSlug = pg.slug; break; }
  return {
    store: f.key,
    currency: profile.currency,
    defaultGround: theme.theme.defaultGround,
    guestCheckout: fulfilment.allowGuestCheckout,
    deliveryEnabled: fulfilment.deliveryEnabled,
    pickupEnabled: fulfilment.pickupEnabled,
    paymentMethods: methods.map((m) => m.method),
    productSlugs: {
      purchasable: slugs((p, d) => purchasable(d)),
      soldOut: slugs((p, d) => !purchasable(d)),
      lowStock: slugs((p, d) => d.variants.some((v) => v.purchasable && v.lowStock)),
      noImages: slugs((p) => !(p.images ?? []).length),
      noAxes: slugs((p) => !p.optionAxes.length),
      withAxes: slugs((p) => p.optionAxes.length > 0),
    },
    categorySlug: firstWithProducts(categories, "category"),
    collectionSlug: firstWithProducts(collections, "collection"),
    pageSlug,
    minimumOrder: fulfilment.orderMinimum,
  };
}

/* ------------------------------------------------------------------ main */
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--check")) return runCheck(argv.includes("--self-test"), !argv.includes("--no-image-files"));
  const i = argv.indexOf("--store");
  const f = await loadStore(i >= 0 ? argv[i + 1] : undefined);

  const env = {
    BACKEND_URL: process.env.BACKEND_URL ?? "http://localhost:3040",
    MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://localhost:27020/?replicaSet=rs0&directConnection=true",
    MONGODB_DB: process.env.MONGODB_DB, OWNER_EMAIL: process.env.OWNER_EMAIL, OWNER_PASSWORD: process.env.OWNER_PASSWORD,
  };
  const ci = argv.indexOf("--confirm-db");
  if (ci >= 0 && !argv[ci + 1]) throw new Error("--confirm-db needs the database name");
  guard(env, ci >= 0 ? argv[ci + 1] : undefined);
  const problems = checkFixture(f, { imageDir: IMG_DIR, brandDir: BRAND_DIR });
  if (problems.length) throw new Error(`Fixture ${f.key} failed its structural check:\n  - ${problems.join("\n  - ")}`);

  log(`seeding ${f.key} -> db "${env.MONGODB_DB}" via ${new URL(env.BACKEND_URL).host}`);
  const http = new Http(env.BACKEND_URL, path.join(os.tmpdir(), `store-fixture-cookies-${env.MONGODB_DB.replace(/[^A-Za-z0-9_-]/g, "_")}.json`));
  http.email = env.OWNER_EMAIL; http.password = env.OWNER_PASSWORD;

  await ensureOwner(env, http);
  if (http.cookies.size && (await http.refresh())) { /* reused the persisted session */ } else await http.login(env.OWNER_EMAIL, env.OWNER_PASSWORD);
  log("authenticated");
  await seed(f, http);
  const m = await manifest(f, http);
  log("DONE");
  console.log(`FIXTURE_MANIFEST ${JSON.stringify(m)}`);
  if (process.env.FIXTURE_MANIFEST_OUT) fs.writeFileSync(process.env.FIXTURE_MANIFEST_OUT, JSON.stringify(m, null, 2) + "\n");
}
main().catch((e) => { console.error("\nSEED FAILED:\n" + e.message); process.exit(1); });
