import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { sanitizeLeanResult } from "@kira-joo/backend-toolkit-mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { BrandModel } from "src/server/catalog/brand.schema";
import { CatalogImportBatchModel } from "src/server/catalog/catalog-import-batch.schema";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { StockMovementModel } from "src/server/catalog/stock-movement.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { StoreProfileModel } from "src/server/content/store-profile.schema";
import { stockMovementRepository, variantRepository } from "src/server/core/repositories";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";
import { csvForm } from "../test-support/csv-fixtures";

/**
 * The bulk catalog import, as Next calls it: stage a CSV (nothing goes live), preview, publish — one transaction,
 * once — with the cache tag declared only when the publish succeeded.
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const collection = (await import("./route")) as unknown as { GET: RouteHandler; POST: RouteHandler };
const one = (await import("./[id]/route")) as unknown as { GET: RouteHandler; DELETE: RouteHandler };
const publishRoute = (await import("./[id]/publish/route")).PUT as RouteHandler;

const HEADER = "product_slug,name_en,name_ar,description_ar,category_slug,brand_slug,status,option_axes,option_value_labels,attributes,sku,option_values,price,compare_at_price,cost,stock,weight_g,unit_of_measure,active";
const GOOD = [
  HEADER,
  'thawb,Thawb,ثوب قطن,"ثوب قطني، مريح",tops,acme,published,"colour|Colour|اللون;size","colour.white=White|أبيض","material=cotton|Cotton|قطن",TH-W-M,colour=white;size=m,450,500,200,12,600,EACH,',
  "thawb,,,,,,,,,,TH-W-L,colour=white;size=l,450,,200,0,,,",
  "thawb,,,,,,,,,,TH-B-M,colour=black;size=m,460,,210,3,,,no",
  "mug,Mug,كوب,وصف,tops,,draft,,,,MUG-1,,35.50,,,8,,,",
].join("\n");

let owner: AdminCaller;
const revalidations: Array<{ tags: string[] }> = [];
const realFetch = globalThis.fetch;

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
  vi.unstubAllGlobals();
});
function failAfterWrite(repo: object, method: string, nth: number) {
  const target = repo as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method]!.bind(repo);
  let calls = 0;
  spies.push(
    vi.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
      const result = await original(...args);
      calls += 1;
      if (calls === nth) throw new Error("injected failure");
      return result;
    })
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sanitizeLeanResult revives BSON Decimal128 into Decimal, so the lean document's real type differs from the schema type; these tests read it as loosely-typed data.
const lean = <T>(value: T) => sanitizeLeanResult(value) as T extends null ? null : any;
const stage = async (content: string | Uint8Array, caller = owner, filename = "catalog.csv") => caller.call(collection.POST, "/api/admin/catalog-imports", { method: "POST", body: csvForm(content, filename) });
const stageOk = async (content = GOOD) => {
  const response = await stage(content);
  expect(response.status).toBe(201);
  return (await response.json()) as { _id: string; status: string; rowErrors: Array<{ row: number; message: string }>; warnings: unknown[]; summary: unknown; rows: Array<{ slug: string; variants: unknown[] }> };
};
const publish = (id: string, caller = owner) => caller.call(publishRoute, `/api/admin/catalog-imports/${id}/publish`, { method: "PUT", params: { id } });
const live = async () => ({ products: await ProductModel.countDocuments(), variants: await VariantModel.countDocuments(), movements: await StockMovementModel.countDocuments() });

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([removeHarnessStaff(), ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({}), BrandModel.deleteMany({}), StockMovementModel.deleteMany({}), CatalogImportBatchModel.deleteMany({}), StoreProfileModel.deleteMany({})]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({}), BrandModel.deleteMany({}), StockMovementModel.deleteMany({}), CatalogImportBatchModel.deleteMany({}), StoreProfileModel.deleteMany({})]);
  await CategoryModel.create({ slug: "tops", name: { ar: "ملابس", en: "Tops" }, published: true });
  await BrandModel.create({ slug: "acme", name: { ar: "أكمي", en: "Acme" }, published: true });
  await StoreProfileModel.create({ defaultLocale: "ar", currency: "EGP", contact: { phone: "1", email: "a@b.c" } });
  revalidations.length = 0;
  process.env.STOREFRONT_REVALIDATE_URL = "http://storefront.test/api/revalidate";
  process.env.REVALIDATE_SECRET = "test-revalidate-secret";
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("http://storefront.test/")) {
      revalidations.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    }
    return realFetch(url, init);
  });
});

describe("staging", () => {
  it("stores a STAGED batch with a summary, the parsed products and no errors — and changes NOTHING live", async () => {
    const batch = await stageOk();
    expect(batch.status).toBe("STAGED");
    expect(batch.rowErrors).toEqual([]);
    expect(batch.summary).toEqual({ lines: 4, products: { create: 2, update: 0 }, variants: { create: 4, update: 0 }, stockMovements: { receipts: 3, adjustments: 0 }, errors: 0, warnings: expect.any(Number) });
    expect(batch.rows.map((product) => [product.slug, product.variants.length])).toEqual([["thawb", 3], ["mug", 1]]);

    expect(await live()).toEqual({ products: 0, variants: 0, movements: 0 });
    // Nothing customers can see changed, so nothing was invalidated.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(revalidations).toEqual([]);
  });

  it("stores a batch WITH its row errors so the preview can show them, still changing nothing live", async () => {
    const bad = [HEADER, "a,A,ا,,nope,,,,,,A-1,,ten,,,1,,,", "b,B,ب,,tops,,published,,,,B-1,,5,,,,,,"].join("\n").replace("b,B,ب", "b,B,");
    const batch = await stageOk(bad);
    expect(batch.rowErrors.map((e) => e.row)).toEqual(expect.arrayContaining([2, 3]));
    expect(batch.rowErrors.some((e) => /Category "nope" does not exist/.test(e.message))).toBe(true);
    expect(batch.rowErrors.some((e) => /price "ten" is not an amount/.test(e.message))).toBe(true);
    // D-11: line 3 is `published` with no default-language (Arabic) name.
    expect(batch.rowErrors.some((e) => e.row === 3 && /default language/.test(e.message))).toBe(true);
    expect(await live()).toEqual({ products: 0, variants: 0, movements: 0 });
  });

  it("refuses a file that cannot be read as a catalog (400) and stores no batch", async () => {
    for (const content of ["", "product_slug,name_en\nx,y", `${HEADER}\n"unclosed`]) {
      expect((await stage(content)).status).toBe(400);
    }
    expect(await CatalogImportBatchModel.countDocuments()).toBe(0);
  });

  it("refuses a file that is not UTF-8 — Arabic in Windows-1256 would be corrupted silently", async () => {
    const windows1256 = new Uint8Array([...new TextEncoder().encode(`${HEADER}\nx,`), 0xe3, 0xd5, 0xc8, ...new TextEncoder().encode(",,,,,,,,,,S,,1,,,,,,\n")]);
    const response = await stage(windows1256);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/UTF-8/);
    expect(await CatalogImportBatchModel.countDocuments()).toBe(0);
  });

  it("refuses a non-CSV upload and a missing file", async () => {
    expect((await collection.POST(new (await import("next/server")).NextRequest("http://localhost/x"), { params: Promise.resolve({}) })).status).toBeGreaterThanOrEqual(400);
    const response = await owner.call(collection.POST, "/api/admin/catalog-imports", { method: "POST", body: csvForm("x", "photo.png", "image/png") });
    expect(response.status).toBe(400);
  });

  it("an Arabic round trip: what was staged is read back exactly", async () => {
    const batch = await stageOk();
    const read = await (await owner.call(one.GET, `/api/admin/catalog-imports/${batch._id}`, { params: { id: batch._id } })).json();
    const thawb = read.rows[0];
    expect(thawb.name).toEqual({ en: "Thawb", ar: "ثوب قطن" });
    expect(thawb.description).toEqual({ ar: "ثوب قطني، مريح" });
    expect(thawb.optionAxes[0].name).toEqual({ en: "Colour", ar: "اللون" });
    expect(read.filename).toBe("catalog.csv");
  });
});

describe("publishing", () => {
  it("applies everything: products, variants, axes, attributes, opening-stock RECEIPTs — and answers with what it did", async () => {
    const batch = await stageOk();
    const response = await publish(batch._id);
    expect(response.status).toBe(200);
    const published = await response.json();
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishResult).toEqual({ products: { created: 2, updated: 0 }, variants: { created: 4, updated: 0 }, stockMovements: { receipts: 3, adjustments: 0 } });

    const thawb = lean(await ProductModel.findOne({ slug: "thawb" }).lean());
    expect(thawb.name).toEqual({ en: "Thawb", ar: "ثوب قطن" });
    expect(thawb.description).toEqual({ en: "", ar: "ثوب قطني، مريح" });
    expect(thawb.lifecycle).toBe("published");
    expect(thawb.brandId.toString()).toBe((await BrandModel.findOne({ slug: "acme" }))!._id.toString());
    expect(thawb.optionAxes.map((axis: { key: string }) => axis.key)).toEqual(["colour", "size"]);
    expect(thawb.optionAxes[0].values.map((v: { key: string; label: { en: string; ar: string } }) => [v.key, v.label.en, v.label.ar])).toEqual([["white", "White", "أبيض"], ["black", "black", "black"]]);
    expect(thawb.attributes[0].values[0].value).toEqual({ en: "Cotton", ar: "قطن" });
    expect(thawb.listing.purchasableVariantCount).toBe(1); // TH-W-L has no stock, TH-B-M is off sale — only TH-W-M can be bought

    const variants = lean(await VariantModel.find({ productId: thawb._id }).lean());
    const bySku = Object.fromEntries(variants.map((v: { sku: string }) => [v.sku, v]));
    expect(bySku["TH-W-M"].price.toFixed(2)).toBe("450.00");
    expect(bySku["TH-W-M"].compareAtPrice.toFixed(2)).toBe("500.00");
    expect(bySku["TH-W-M"].weight).toBe(600);
    expect(bySku["TH-W-M"].stock).toBe(12);
    expect(bySku["TH-B-M"].discontinued).toBe(true);
    expect(bySku["TH-W-M"].variantKey).toBe(`${thawb._id}|colour=white|size=m`);

    const movements = await StockMovementModel.find({}).lean();
    expect(movements.map((m) => [m.reason, m.delta]).sort()).toEqual([["RECEIPT", 12], ["RECEIPT", 3], ["RECEIPT", 8]].sort());
    expect(movements.every((m) => m.actorId)).toBe(true);
  });

  it("updates an existing product and its variants: price, text, and stock as an ADJUSTMENT; what the file omits is untouched", async () => {
    expect((await publish((await stageOk())._id)).status).toBe(200);
    const before = lean(await VariantModel.findOne({ sku: "TH-W-L" }).lean());
    const update = [
      "product_slug,name_en,sku,price,stock",
      "thawb,Thawb Deluxe,TH-W-M,480,7", // 12 -> 7: adjustment -5
      "thawb,,TH-W-L,455,", // stock blank: untouched
      "mug,,MUG-1,36,8", // same stock: no movement
    ].join("\n");
    const batch = await stageOk(update);
    expect(batch.summary).toMatchObject({ products: { create: 0, update: 2 }, variants: { create: 0, update: 3 }, stockMovements: { receipts: 0, adjustments: 1 } });
    expect((await publish(batch._id)).status).toBe(200);

    const thawb = lean(await ProductModel.findOne({ slug: "thawb" }).lean());
    expect(thawb.name).toEqual({ en: "Thawb Deluxe", ar: "ثوب قطن" }); // Arabic kept: a blank cell never erases
    expect(thawb.lifecycle).toBe("published");
    const wm = lean(await VariantModel.findOne({ sku: "TH-W-M" }).lean());
    expect(wm.price.toFixed(2)).toBe("480.00");
    expect(wm.compareAtPrice.toFixed(2)).toBe("500.00"); // untouched
    expect(wm.stock).toBe(7);
    const wl = lean(await VariantModel.findOne({ sku: "TH-W-L" }).lean());
    expect(wl.price.toFixed(2)).toBe("455.00");
    expect(wl.stock).toBe(before.stock);
    const adjustments = await StockMovementModel.find({ reason: "ADJUSTMENT" }).lean();
    expect(adjustments.map((m) => m.delta)).toEqual([-5]);
    expect(adjustments[0]?.note).toMatch(/Catalog import/);
  });

  it("is idempotent: a second publish of the same batch is refused (409) and applies nothing more", async () => {
    const batch = await stageOk();
    expect((await publish(batch._id)).status).toBe(200);
    const after = await live();
    const again = await publish(batch._id);
    expect(again.status).toBe(409);
    expect(await live()).toEqual(after);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
  });

  it("two concurrent publishes of one batch: exactly one applies", async () => {
    const batch = await stageOk();
    const results = await Promise.all([publish(batch._id), publish(batch._id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await ProductModel.countDocuments()).toBe(2);
    expect(await StockMovementModel.countDocuments()).toBe(3);
  });

  it("ROLLBACK: a failure part-way leaves nothing — no product, variant, movement — and the batch stays STAGED, retryable", async () => {
    const batch = await stageOk();
    failAfterWrite(variantRepository, "save", 3);
    const response = await publish(batch._id);
    expect(response.status).toBe(500);

    expect(await live()).toEqual({ products: 0, variants: 0, movements: 0 });
    expect((await CatalogImportBatchModel.findById(batch._id).lean())?.status).toBe("STAGED");
    expect((await CatalogImportBatchModel.findById(batch._id).lean())?.publishedAt).toBeUndefined();

    spies.pop()!.mockRestore();
    expect((await publish(batch._id)).status).toBe(200);
    expect(await live()).toMatchObject({ products: 2, variants: 4, movements: 3 });
  });

  it("ROLLBACK: a failure while writing a movement undoes the variants and products before it", async () => {
    const batch = await stageOk();
    failAfterWrite(stockMovementRepository, "save", 2);
    expect((await publish(batch._id)).status).toBe(500);
    expect(await live()).toEqual({ products: 0, variants: 0, movements: 0 });
  });

  it("re-validates against the catalog as it is NOW: a category deleted after staging refuses the whole batch", async () => {
    const batch = await stageOk();
    await CategoryModel.deleteMany({});
    const response = await publish(batch._id);
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toMatch(/catalog changed since this batch was staged.*Category .{1,3}tops.{1,3} does not exist/);
    expect(await live()).toEqual({ products: 0, variants: 0, movements: 0 });
    expect((await CatalogImportBatchModel.findById(batch._id).lean())?.status).toBe("STAGED");
  });

  it("a SKU taken by another product between staging and publishing is caught, and nothing is applied", async () => {
    const batch = await stageOk();
    const other = await ProductModel.create({ name: { ar: "ا", en: "A" }, description: { ar: "", en: "" }, slug: "other", categoryId: (await CategoryModel.findOne({}))!._id });
    await VariantModel.create({ productId: other._id, sku: "MUG-1", variantKey: `${other._id}`, price: toMoney("1.00"), stock: 0 });
    const response = await publish(batch._id);
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toMatch(/SKU .{1,3}MUG-1.{1,3} already belongs to product .{1,3}other.{1,3}/);
    expect(await ProductModel.countDocuments()).toBe(1);
  });

  it("refuses to publish a batch with row errors, and one already discarded", async () => {
    const withErrors = await stageOk([HEADER, "a,A,ا,,nope,,,,,,A-1,,5,,,,,,"].join("\n"));
    expect((await publish(withErrors._id)).status).toBe(409);

    const clean = await stageOk();
    expect((await owner.call(one.DELETE, `/api/admin/catalog-imports/${clean._id}`, { method: "DELETE", params: { id: clean._id } })).status).toBeLessThan(300);
    expect((await CatalogImportBatchModel.findById(clean._id).lean())?.status).toBe("DISCARDED");
    expect((await publish(clean._id)).status).toBe(409);
    expect(await live()).toEqual({ products: 0, variants: 0, movements: 0 });
  });

  it("an unknown batch is 404", async () => {
    expect((await publish(new mongoose.Types.ObjectId().toString())).status).toBe(404);
  });
});

describe("cache invalidation", () => {
  it("a successful publish declares PRODUCTS exactly once", async () => {
    const batch = await stageOk();
    expect((await publish(batch._id)).status).toBe(200);
    await vi.waitFor(() => expect(revalidations).toHaveLength(1));
    expect(revalidations[0]?.tags).toEqual(["PRODUCTS"]);
  });

  it("a refused publish, a rolled-back publish and a staging each declare nothing", async () => {
    const batch = await stageOk();
    await CategoryModel.deleteMany({});
    expect((await publish(batch._id)).status).toBe(409); // refused

    await CategoryModel.create({ slug: "tops", name: { ar: "ملابس", en: "Tops" }, published: true });
    const second = await stageOk();
    failAfterWrite(variantRepository, "save", 2);
    expect((await publish(second._id)).status).toBe(500); // rolled back

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(revalidations).toEqual([]);
  });
});

describe("permissions — the negative cases", () => {
  it.each([
    ["read-only", [AppPermission.CATALOG_IMPORT_BATCH.READ, AppPermission.CATALOG_IMPORT_BATCH.READ_ONE]],
    ["Product.create (a different entity)", [AppPermission.PRODUCT.CREATE, AppPermission.VARIANT.CREATE]],
    ["Catalog.publish alone", [CustomPermission.CATALOG_PUBLISH]],
  ])("%s cannot stage: 403, no batch stored", async (_label, keys) => {
    const staff = await signInWithPermissions(keys);
    expect((await stage(GOOD, staff)).status).toBe(403);
    expect(await CatalogImportBatchModel.countDocuments()).toBe(0);
  });

  it.each([
    ["staging and reading rights (CatalogImportBatch.*) — publishing is a separate power", [AppPermission.CATALOG_IMPORT_BATCH.CREATE, AppPermission.CATALOG_IMPORT_BATCH.READ, AppPermission.CATALOG_IMPORT_BATCH.READ_ONE, AppPermission.CATALOG_IMPORT_BATCH.UPDATE, AppPermission.CATALOG_IMPORT_BATCH.DELETE]],
    ["product and variant rights", [AppPermission.PRODUCT.CREATE, AppPermission.PRODUCT.UPDATE, AppPermission.VARIANT.CREATE]],
  ])("%s cannot publish: 403, nothing applied, batch still STAGED, nothing invalidated", async (_label, keys) => {
    const batch = await stageOk();
    const staff = await signInWithPermissions(keys);
    expect((await publish(batch._id, staff)).status).toBe(403);
    expect(await live()).toEqual({ products: 0, variants: 0, movements: 0 });
    expect((await CatalogImportBatchModel.findById(batch._id).lean())?.status).toBe("STAGED");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(revalidations).toEqual([]);
  });

  it("cannot discard without CatalogImportBatch.delete, and cannot read without CatalogImportBatch.read", async () => {
    const batch = await stageOk();
    const stager = await signInWithPermissions([AppPermission.CATALOG_IMPORT_BATCH.CREATE]);
    expect((await stager.call(one.DELETE, `/api/admin/catalog-imports/${batch._id}`, { method: "DELETE", params: { id: batch._id } })).status).toBe(403);
    expect((await stager.call(collection.GET, "/api/admin/catalog-imports")).status).toBe(403);
    expect((await stager.call(one.GET, `/api/admin/catalog-imports/${batch._id}`, { params: { id: batch._id } })).status).toBe(403);
    expect((await CatalogImportBatchModel.findById(batch._id).lean())?.status).toBe("STAGED");
  });

  it("the right permissions work: stage with create, read with read, publish with Catalog.publish", async () => {
    const stager = await signInWithPermissions([AppPermission.CATALOG_IMPORT_BATCH.CREATE]);
    const batch = (await (await stage(GOOD, stager)).json()) as { _id: string };
    const reader = await signInWithPermissions([AppPermission.CATALOG_IMPORT_BATCH.READ, AppPermission.CATALOG_IMPORT_BATCH.READ_ONE]);
    const list = await (await reader.call(collection.GET, "/api/admin/catalog-imports")).json();
    expect(list.data.map((b: { _id: string }) => b._id)).toEqual([batch._id]);
    expect("rows" in list.data[0]).toBe(false);
    expect(list.data[0].summary.products.create).toBe(2);
    const publisher = await signInWithPermissions([CustomPermission.CATALOG_PUBLISH]);
    expect((await publish(batch._id, publisher)).status).toBe(200);
  });
});
