import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { toMoney } from "@kira-joo/toolkit-common";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { CategoryModel } from "src/server/catalog/category.schema";
import { CollectionModel } from "src/server/catalog/collection.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { ProductGroupModel } from "src/server/catalog/product-group.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { PendingUploadModel } from "src/server/catalog/pending-upload.schema";
import { harnessCookieJar, removeHarnessStaff, signInAsOwner, type RouteHandler } from "./test-support/admin-route-harness";
import { createStaffClient } from "../../../../scripts/catalog-import/staff-client.mjs";
import { runImport } from "../../../../scripts/catalog-import/run.mjs";
import { LOCK_FILE, STATE_FILE } from "../../../../scripts/catalog-import/state.mjs";
import { png } from "../../../../scripts/catalog-import/test-fixtures.mjs";

/**
 * The catalog importer end to end against the REAL admin routes (auth, DTO validation, services, transactions) and a
 * real database — its `fetch` is wired to the route handlers in-process. Only the image storage provider is a
 * recording stub: no file reaches Cloudinary.
 */
const provider = vi.hoisted(() => ({
  uploads: [] as string[],
  alive: new Set<string>(),
  uploadImage: async (_buffer: Buffer, options: { folder: string }) => {
    const publicId = `${options.folder}/upload-${provider.uploads.length + 1}`;
    provider.uploads.push(publicId);
    provider.alive.add(publicId);
    return { provider: "cloudinary", publicId, secureUrl: `https://res.example/${publicId}.png`, format: "png", width: 300, height: 300, bytes: 1000 };
  },
}));
vi.mock("src/server/core/assets/asset-providers", () => ({ assetProvider: () => provider }));
vi.mock("next/headers", async () => {
  const { harnessCookieJar: jar } = await import("./test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

type Module = Partial<Record<"GET" | "POST" | "PUT" | "DELETE", RouteHandler>>;
const routes: Array<[RegExp, Module]> = [
  [/^\/api\/admin\/categories$/, await import("./categories/route")],
  [/^\/api\/admin\/collections$/, await import("./collections/route")],
  [/^\/api\/admin\/products$/, await import("./products/route")],
  [/^\/api\/admin\/products\/(?<id>[^/]+)$/, await import("./products/[id]/route")],
  [/^\/api\/admin\/products\/(?<id>[^/]+)\/lifecycle$/, await import("./products/[id]/lifecycle/route")],
  [/^\/api\/admin\/variants$/, await import("./variants/route")],
  [/^\/api\/admin\/media\/product-images$/, await import("./media/product-images/route")],
  [/^\/api\/admin\/product-groups$/, await import("./product-groups/route")],
  [/^\/api\/admin\/product-groups\/(?<id>[^/]+)$/, await import("./product-groups/[id]/route")],
  [/^\/api\/admin\/product-groups\/(?<id>[^/]+)\/members$/, await import("./product-groups/[id]/members/route")],
] as unknown as Array<[RegExp, Module]>;

/** Requests to fail on purpose, to exercise a stop half-way: "METHOD path-substring" or a predicate on the body. */
let failNext: Array<(method: string, path: string, body: unknown) => boolean> = [];
/** Requests the SERVER completes but whose response is lost on the way back (a crash / dropped connection). */
let loseResponse: Array<(method: string, path: string, body: unknown) => boolean> = [];
const calls: string[] = [];

async function inProcessFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init.method ?? "GET").toUpperCase();
  if (url.hostname === "res.example") return new Response(null, { status: provider.alive.has(url.pathname.slice(1).replace(/\.png$/, "")) ? 200 : 404 });
  calls.push(`${method} ${url.pathname}`);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
  const failure = failNext.findIndex((matches) => matches(method, url.pathname, body));
  if (failure >= 0) {
    failNext.splice(failure, 1);
    return new Response(JSON.stringify({ message: "injected failure" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  for (const [pattern, module] of routes) {
    const match = pattern.exec(url.pathname);
    const handler = match && module[method as keyof Module];
    if (handler) {
      const headers = new Headers(init.headers);
      if (method !== "GET") headers.set("Idempotency-Key", crypto.randomUUID());
      const response = await handler(new NextRequest(url, { method, headers, body: init.body as BodyInit | undefined }), { params: Promise.resolve({ ...(match.groups ?? {}) }) });
      const lost = loseResponse.findIndex((matches) => matches(method, url.pathname, body));
      if (lost >= 0) {
        loseResponse.splice(lost, 1);
        throw new TypeError("fetch failed (connection lost)");
      }
      return response;
    }
  }
  return new Response(JSON.stringify({ message: `no route ${method} ${url.pathname}` }), { status: 404 });
}

let categoryId: string;
let collectionId: string;
let dir: string;

function client() {
  const staff = createStaffClient({ target: "http://localhost", fetch: inProcessFetch });
  staff.useSessionCookie(harnessCookieJar.values().next().value as string);
  return staff;
}
const run = (mode: "dry-run" | "execute") => runImport({ dir, client: client(), mode });

/** Writes a batch into a fresh import folder: products a, b, c (b and c grouped, c listed first), one image each. */
function writeBatch(options: { productOverrides?: Record<string, object>; images?: Record<string, Buffer | null>; groups?: unknown[] } = {}) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "product-import-"));
  const entry = (slug: string, lifecycle: string, skus: string[]) => ({
    sourceImageFilename: `${slug}.png`,
    product: { name: { en: `${slug} name`, ar: `اسم ${slug}` }, description: { en: "d", ar: "و" }, slug, categoryId, collectionIds: [collectionId], optionAxes: skus.length > 1 ? [{ key: "size", name: { en: "Size", ar: "المقاس" } }] : [], attributes: [], lifecycle, ...(options.productOverrides?.[slug] ?? {}) },
    variants: skus.map((sku, i) => ({ sku, optionValues: skus.length > 1 ? [{ key: "size", value: ["S", "M"][i] }] : [], price: `${100 + i}.50`, stock: 3 + i })),
  });
  const catalog = {
    products: [entry("clip-a", "published", ["CLIP-A"]), entry("clip-b", "published", ["CLIP-B-1", "CLIP-B-2"]), entry("clip-c", "draft", ["CLIP-C"])],
    productGroupAssignmentSteps: options.groups ?? [
      { groupName: { en: "Clips", ar: "كليبس" }, membersInStorefrontOrder: [{ productSlug: "clip-c", label: { en: "Cream", ar: "كريمي" } }, { productSlug: "clip-b", label: { en: "Black", ar: "أسود" } }] },
    ],
  };
  fs.writeFileSync(path.join(dir, "catalog.json"), JSON.stringify(catalog, null, 2));
  for (const [i, slug] of ["clip-a", "clip-b", "clip-c"].entries()) {
    const image = options.images && slug in options.images ? options.images[slug] : png(300, 300, i + 1);
    if (image) fs.writeFileSync(path.join(dir, `${slug}.png`), image);
  }
}

const counts = async () => ({
  products: await ProductModel.countDocuments({}),
  variants: await VariantModel.countDocuments({}),
  groups: await ProductGroupModel.countDocuments({}),
  pendingUploads: await PendingUploadModel.countDocuments({}),
  uploads: provider.uploads.length,
});
const wipe = () => Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), ProductGroupModel.deleteMany({}), PendingUploadModel.deleteMany({}), CategoryModel.deleteMany({}), CollectionModel.deleteMany({})]);

beforeAll(async () => {
  await connectToDatabase();
  await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([wipe(), removeHarnessStaff()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await wipe();
  provider.uploads.length = 0;
  provider.alive.clear();
  failNext = [];
  loseResponse = [];
  calls.length = 0;
  categoryId = (await CategoryModel.create({ slug: "hair-accessories", published: true }))._id.toString();
  collectionId = (await CollectionModel.create({ slug: "new-in", name: { en: "New", ar: "جديد" } }))._id.toString();
});

describe("dry run", () => {
  it("plans every product, image, variant and group — and writes NOTHING (no upload, no record, no state file)", async () => {
    writeBatch();
    const before = await counts();
    const report = await run("dry-run");
    expect(report.outcome).toBe("ready");
    expect(report.plan.products.map((p: { slug: string; status: string; images: Array<{ filename: string; action: string }> }) => `${p.slug}:${p.status}:${p.images[0]?.filename}:${p.images[0]?.action}`)).toEqual([
      "clip-a:create:clip-a.png:upload",
      "clip-b:create:clip-b.png:upload",
      "clip-c:create:clip-c.png:upload",
    ]);
    expect(report.plan.groups[0].members.map((m: { productSlug: string }) => m.productSlug)).toEqual(["clip-c", "clip-b"]);
    expect(await counts()).toEqual(before);
    expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
    expect(fs.existsSync(path.join(dir, STATE_FILE))).toBe(false);
    expect(fs.existsSync(report.file)).toBe(true);
  });

  it.each([
    ["a missing image", { images: { "clip-b": null } }, 'image "clip-b.png" file not found'],
    ["an unknown category", { productOverrides: { "clip-a": { categoryId: new mongoose.Types.ObjectId().toString() } } }, "does not exist in the store"],
    ["an unknown collection", { productOverrides: { "clip-a": { collectionIds: [new mongoose.Types.ObjectId().toString()] } } }, "collection"],
    ["an image the server would refuse (too small)", { images: { "clip-a": png(100, 100, 9) } }, "below the 200px minimum"],
  ])("BLOCKS on %s — and --execute then refuses to start, writing nothing", async (_label, options, message) => {
    writeBatch(options as Parameters<typeof writeBatch>[0]);
    const dry = await run("dry-run");
    expect(dry.outcome).toBe("blocked");
    expect(dry.plan.blocking.join(" ")).toContain(message);
    const before = await counts();
    const execute = await run("execute");
    expect(execute.outcome).toBe("blocked");
    expect(execute.steps).toEqual([]);
    expect(await counts()).toEqual(before);
  });
});

describe("execute", () => {
  it("uploads each product's own image, creates products and variants, sets the JSON lifecycle, creates the group in the given order, and verifies it all", async () => {
    writeBatch();
    const report = await run("execute");
    expect(report.steps.filter((step: { ok: boolean }) => !step.ok)).toEqual([]);
    expect(report.outcome).toBe("completed");
    expect(report.verification.filter((check: { ok: boolean }) => !check.ok)).toEqual([]);

    const products = await ProductModel.find({}).sort({ slug: 1 }).lean();
    expect(products.map((p) => [p.slug, p.lifecycle, p.images.map((i) => i.publicId).join(), p.categoryId.toString() === categoryId, p.collectionIds.map(String).join() === collectionId])).toEqual([
      ["clip-a", "published", "mimora/store/products/upload-1", true, true],
      ["clip-b", "published", "mimora/store/products/upload-2", true, true],
      ["clip-c", "draft", "mimora/store/products/upload-3", true, true],
    ]);
    const variants = await VariantModel.find({}).sort({ sku: 1 }).lean();
    expect(variants.map((v) => [v.sku, v.price.toString(), v.stock])).toEqual([
      ["CLIP-A", "100.50", 3],
      ["CLIP-B-1", "100.50", 3],
      ["CLIP-B-2", "101.50", 4],
      ["CLIP-C", "100.50", 3],
    ]);
    const group = await ProductGroupModel.findOne({}).lean();
    expect(group?.name).toEqual({ en: "Clips", ar: "كليبس" });
    const members = await ProductModel.find({ "group.groupId": group!._id }).sort({ "group.order": 1 }).lean();
    expect(members.map((p) => [p.slug, p.group!.label.en, p.group!.label.ar])).toEqual([
      ["clip-c", "Cream", "كريمي"],
      ["clip-b", "Black", "أسود"],
    ]);
    // Created as a draft, variants added, THEN published — never live without a price.
    const order = calls.filter((c) => !c.startsWith("GET "));
    expect(order.indexOf("PUT /api/admin/products/" + products[0]!._id + "/lifecycle")).toBeGreaterThan(order.indexOf("POST /api/admin/variants"));
  });

  it("a second run creates NOTHING: no duplicate product, variant, upload or group", async () => {
    writeBatch();
    await run("execute");
    const after = await counts();
    calls.length = 0;
    const again = await run("execute");
    expect(again.outcome).toBe("completed");
    expect(again.plan.summary).toMatchObject({ products: { create: 0, resume: 0, done: 3, skip: 0 }, uploads: 0, groups: { create: 0, update: 0, done: 1 } });
    expect(await counts()).toEqual(after);
    expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
  });

  it("stops at a failure, keeps a report, and a re-run resumes exactly where it stopped — no re-upload, no duplicate", async () => {
    writeBatch();
    failNext = [(method, p, body) => method === "POST" && p === "/api/admin/variants" && (body as { sku?: string })?.sku === "CLIP-B-2"];
    const first = await run("execute");
    expect(first.outcome).toBe("failed");
    expect(first.steps.at(-1)).toMatchObject({ kind: "variant", subject: "clip-b / CLIP-B-2", ok: false });
    expect(await ProductGroupModel.countDocuments({})).toBe(0); // no group until every member is complete
    expect(await ProductModel.findOne({ slug: "clip-b" }).lean()).toMatchObject({ lifecycle: "draft" }); // not published half-made
    const uploadsBefore = provider.uploads.length;

    const second = await run("execute");
    expect(second.outcome).toBe("completed");
    expect(second.plan.products.map((p: { slug: string; status: string }) => `${p.slug}:${p.status}`)).toEqual(["clip-a:done", "clip-b:resume", "clip-c:create"]);
    expect(provider.uploads.length).toBe(uploadsBefore + 1); // only clip-c's image, never clip-b's again
    expect(await ProductModel.countDocuments({ slug: "clip-b" })).toBe(1);
    expect((await VariantModel.find({ sku: /^CLIP-B/ }).lean()).map((v) => v.sku).sort()).toEqual(["CLIP-B-1", "CLIP-B-2"]);
    expect(await ProductModel.findOne({ slug: "clip-b" }).lean()).toMatchObject({ lifecycle: "published" });
    expect(await ProductGroupModel.countDocuments({})).toBe(1);
  });

  it("an image uploaded before a failed product create is RE-USED on the re-run; re-uploaded only if it has since disappeared", async () => {
    writeBatch();
    failNext = [(method, p, body) => method === "POST" && p === "/api/admin/products" && (body as { slug?: string })?.slug === "clip-a"];
    expect((await run("execute")).outcome).toBe("failed");
    expect(provider.uploads).toEqual(["mimora/store/products/upload-1"]);
    expect(await ProductModel.countDocuments({})).toBe(0);

    const resumed = await run("execute");
    expect(resumed.outcome).toBe("completed");
    expect((await ProductModel.findOne({ slug: "clip-a" }).lean())?.images[0]?.publicId).toBe("mimora/store/products/upload-1");
    expect(provider.uploads.length).toBe(3); // clip-a re-used; clip-b and clip-c uploaded once each

    // Gone from storage (e.g. swept as unused) → uploaded again rather than attaching a dead image.
    await wipe();
    categoryId = (await CategoryModel.create({ slug: "c2", published: true }))._id.toString();
    collectionId = (await CollectionModel.create({ slug: "n2", name: { en: "N", ar: "ن" } }))._id.toString();
    writeBatch();
    failNext = [(method, p, body) => method === "POST" && p === "/api/admin/products" && (body as { slug?: string })?.slug === "clip-a"];
    await run("execute");
    provider.alive.clear();
    const reuploaded = await run("execute");
    expect(reuploaded.steps.find((s: { subject: string }) => s.subject.startsWith("clip-a ←"))).toMatchObject({ ok: true, note: "uploaded again (the earlier upload is gone)" });
  });

  it("a product created on the server whose RESPONSE was lost is recognised on the re-run by its image — no duplicate, no blocked group", async () => {
    writeBatch();
    loseResponse = [(method, p, body) => method === "POST" && p === "/api/admin/products" && (body as { slug?: string })?.slug === "clip-b"];
    const first = await run("execute");
    expect(first.outcome).toBe("failed");
    expect(await ProductModel.countDocuments({ slug: "clip-b" })).toBe(1); // it WAS created

    const second = await run("execute");
    expect(second.outcome).toBe("completed");
    expect(second.plan.products.find((p: { slug: string }) => p.slug === "clip-b").status).toBe("resume");
    expect(second.plan.warnings.join(" ")).toContain("recognised by its uploaded image");
    expect(await ProductModel.countDocuments({ slug: /^clip-b/ })).toBe(1);
    expect(await ProductGroupModel.countDocuments({})).toBe(1);
  });

  it("a group created on the server whose RESPONSE was lost is adopted on the re-run — never a second group", async () => {
    writeBatch();
    loseResponse = [(method, p) => method === "POST" && p === "/api/admin/product-groups"];
    expect((await run("execute")).outcome).toBe("failed");
    expect(await ProductGroupModel.countDocuments({})).toBe(1);
    const second = await run("execute");
    expect(second.outcome).toBe("completed");
    expect(await ProductGroupModel.countDocuments({})).toBe(1);
    expect(await ProductModel.countDocuments({ "group.groupId": { $exists: true } })).toBe(2);
  });

  it("one --execute at a time: a held lock refuses a second run; a finished run releases it", async () => {
    writeBatch();
    fs.writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify({ pid: 1, startedAt: "earlier" }));
    const refused = await run("execute");
    expect(refused.outcome).toBe("blocked");
    expect(refused.plan.blocking[0]).toContain("Another import is running in this folder");
    expect(await ProductModel.countDocuments({})).toBe(0);
    fs.rmSync(path.join(dir, LOCK_FILE));
    expect((await run("execute")).outcome).toBe("completed");
    expect(fs.existsSync(path.join(dir, LOCK_FILE))).toBe(false);
  });

  it("an unreadable state file blocks with an explanation and writes nothing", async () => {
    writeBatch();
    fs.writeFileSync(path.join(dir, STATE_FILE), "{ not json");
    const report = await run("execute");
    expect(report.outcome).toBe("blocked");
    expect(report.plan.blocking[0]).toContain("cannot be read");
    expect(await ProductModel.countDocuments({})).toBe(0);
  });

  it("never touches a product it did not create: an existing slug is SKIPPED and its group is blocked", async () => {
    const existing = await ProductModel.create({ slug: "clip-b", categoryId, lifecycle: "published", name: { en: "Someone else's", ar: "منتج آخر" }, description: { en: "", ar: "" } });
    const before = await ProductModel.findById(existing._id).lean();
    writeBatch();
    const dry = await run("dry-run");
    expect(dry.plan.products.find((p: { slug: string }) => p.slug === "clip-b").status).toBe("skip");
    expect(dry.plan.blocking.join(" ")).toContain("clip-b exists but was not created by this importer");
    const execute = await run("execute");
    expect(execute.outcome).toBe("blocked");
    expect(await ProductModel.findById(existing._id).lean()).toEqual(before);
    expect(await ProductModel.countDocuments({})).toBe(1);
  });

  it("an existing SKU on another product blocks the batch before anything is written", async () => {
    const other = await ProductModel.create({ slug: "other", categoryId, name: { en: "O", ar: "و" }, description: { en: "", ar: "" } });
    await VariantModel.create({ productId: other._id, sku: "CLIP-C", variantKey: "other-1", price: toMoney("1.00"), stock: 1 });
    writeBatch();
    const execute = await run("execute");
    expect(execute.outcome).toBe("blocked");
    expect(execute.plan.blocking.join(" ")).toContain('SKU "CLIP-C" already belongs to another product');
    expect(await ProductModel.countDocuments({})).toBe(1);
    expect(provider.uploads).toEqual([]);
  });
});
