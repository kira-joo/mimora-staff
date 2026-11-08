import mongoose from "mongoose";
import { toMoney, type ImageAsset } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission, CustomPermission } from "src/common/authorization/authorization-registry";
import { PendingUploadModel } from "src/server/catalog/pending-upload.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { CategoryModel } from "src/server/catalog/category.schema";
import { CollectionModel } from "src/server/catalog/collection.schema";
import { StoreProfileModel } from "src/server/content/store-profile.schema";
import { PageModel } from "src/server/content/page.schema";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../../test-support/admin-route-harness";

/**
 * "Clean up unused images" (POST /api/admin/media/sweep-orphans), as Next calls it: real auth and permissions, the real
 * sweep and the real reference check against a real database. Only the storage provider is a recording stub — no
 * Cloudinary is contacted — so "nothing was deleted" is an assertion about its call log.
 */
const provider = vi.hoisted(() => ({
  destroyed: [] as string[],
  failFor: new Set<string>(),
  destroyAsset: async (publicId: string) => {
    if (provider.failFor.has(publicId)) throw new Error("provider down");
    provider.destroyed.push(publicId);
  },
}));
vi.mock("src/server/core/assets/asset-providers", () => ({ assetProvider: () => provider }));
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const cleanUp = (await import("./route")).POST as RouteHandler;
const PATH = "/api/admin/media/sweep-orphans";

const HOUR = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR);
const image = (publicId: string): ImageAsset => ({ provider: "cloudinary" as ImageAsset["provider"], publicId, secureUrl: `https://res.example/${publicId}.png`, format: "png", width: 400, height: 400, bytes: 1000 });
const pending = (publicId: string, createdAt: Date) => PendingUploadModel.collection.insertOne({ publicId, createdAt, updatedAt: createdAt });
const pendingIds = async () => (await PendingUploadModel.find({}).lean()).map((row) => row.publicId).sort();

const wipe = () =>
  Promise.all([
    PendingUploadModel.deleteMany({}),
    ProductModel.deleteMany({}),
    VariantModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    CollectionModel.deleteMany({}),
    StoreProfileModel.deleteMany({}),
    PageModel.deleteMany({}),
  ]);

let owner: AdminCaller;
beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([wipe(), removeHarnessStaff()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  provider.destroyed.length = 0;
  provider.failFor.clear();
  await wipe();
});

const run = async (caller: AdminCaller = owner) => {
  const response = await caller.call(cleanUp, PATH, { method: "POST" });
  return { status: response.status, body: (await response.json()) as { examined: number; kept: number; destroyed: string[]; failed: string[] } };
};

describe("Clean up unused images — what it deletes", () => {
  it("deletes an unused upload older than 24 hours and answers the four counts", async () => {
    await pending("mimora/store/products/abandoned", hoursAgo(30));

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toEqual({ examined: 1, kept: 0, destroyed: ["mimora/store/products/abandoned"], failed: [] });
    expect(provider.destroyed).toEqual(["mimora/store/products/abandoned"]);
    expect(await pendingIds()).toEqual([]);
  });

  it("never deletes an image a record uses — product, variant gallery, category, collection image and icon, store profile, page", async () => {
    const category = await CategoryModel.create({ slug: "c", published: true, image: image("mimora/store/categories/in-use") });
    const product = await ProductModel.create({ slug: "p", categoryId: category._id, lifecycle: "published", name: { en: "P", ar: "م" }, images: [image("mimora/store/products/in-use")] });
    await VariantModel.create({ productId: product._id, sku: "P-1", variantKey: "p-1", price: toMoney("1.00"), stock: 1, galleryOverride: [image("mimora/store/products/variant-pick")] });
    await CollectionModel.create({ slug: "k", name: { en: "K", ar: "ك" }, image: image("mimora/store/collections/cover"), icon: image("mimora/store/collections/icon") });
    await StoreProfileModel.collection.insertOne({ logo: image("mimora/store/store-profile/logo") });
    await PageModel.collection.insertOne({ slug: "about", seo: { ogImage: image("mimora/store/store-profile/page-share") } });
    const inUse = [
      "mimora/store/categories/in-use",
      "mimora/store/products/in-use",
      "mimora/store/products/variant-pick",
      "mimora/store/collections/cover",
      "mimora/store/collections/icon",
      "mimora/store/store-profile/logo",
      "mimora/store/store-profile/page-share",
    ];
    for (const id of inUse) await pending(id, hoursAgo(48));

    const { status, body } = await run();

    expect(status).toBe(200);
    expect(body).toEqual({ examined: inUse.length, kept: inUse.length, destroyed: [], failed: [] });
    expect(provider.destroyed).toEqual([]);
    // A used image stops being "pending": it is a live asset now, removed only when its record replaces or drops it.
    expect(await pendingIds()).toEqual([]);
  });

  it("keeps the 24-hour safety threshold: a younger upload is not checked or deleted, however unused", async () => {
    await pending("mimora/store/products/just-uploaded", hoursAgo(23));
    await pending("mimora/store/products/old", hoursAgo(25));

    const { body } = await run();

    expect(body).toEqual({ examined: 1, kept: 0, destroyed: ["mimora/store/products/old"], failed: [] });
    expect(provider.destroyed).toEqual(["mimora/store/products/old"]);
    expect(await pendingIds()).toEqual(["mimora/store/products/just-uploaded"]);
  });

  it("never deletes anything outside Mimora's mimora/store/ folder, even if it is listed as pending", async () => {
    await pending("other-app/products/foreign", hoursAgo(30));
    await pending("store/products/pre-namespace", hoursAgo(30));
    await pending("mimora/payment-proofs/orders/ORD-000001/receipt", hoursAgo(30));

    const { body } = await run();

    expect(provider.destroyed).toEqual([]);
    expect(body.destroyed).toEqual([]);
    expect(await pendingIds()).toEqual([]);
  });

  it("a storage failure is reported as Failed, keeps the upload pending, and does not stop the others", async () => {
    await pending("mimora/store/products/stuck", hoursAgo(40));
    await pending("mimora/store/products/fine", hoursAgo(30));
    provider.failFor.add("mimora/store/products/stuck");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { status, body } = await run();
      expect(status).toBe(200);
      expect(body).toEqual({ examined: 2, kept: 0, destroyed: ["mimora/store/products/fine"], failed: ["mimora/store/products/stuck"] });
      expect(await pendingIds()).toEqual(["mimora/store/products/stuck"]);
    } finally {
      log.mockRestore();
    }

    provider.failFor.clear();
    const retry = await run();
    expect(retry.body).toEqual({ examined: 1, kept: 0, destroyed: ["mimora/store/products/stuck"], failed: [] });
  });

  it("is safe to run twice: the second run has nothing left to check", async () => {
    await pending("mimora/store/products/abandoned", hoursAgo(30));
    await run();
    provider.destroyed.length = 0;

    const { body } = await run();

    expect(body).toEqual({ examined: 0, kept: 0, destroyed: [], failed: [] });
    expect(provider.destroyed).toEqual([]);
  });
});

describe("Clean up unused images — who may run it", () => {
  it.each([
    ["no permissions at all", []],
    ["Product create and update", [AppPermission.PRODUCT.CREATE, AppPermission.PRODUCT.UPDATE]],
    ["catalog import staging only", [AppPermission.CATALOG_IMPORT_BATCH.CREATE]],
    ["Order.transition (the unpaid-order action's permission)", [CustomPermission.ORDER_TRANSITION]],
  ])("NEGATIVE: %s is refused (403) and nothing is deleted", async (_label, keys) => {
    await pending("mimora/store/products/abandoned", hoursAgo(30));
    const staff = await signInWithPermissions(keys);

    const { status } = await run(staff);

    expect(status).toBe(403);
    expect(provider.destroyed).toEqual([]);
    expect(await pendingIds()).toEqual(["mimora/store/products/abandoned"]);
  });

  it("Catalog.publish alone is enough", async () => {
    await pending("mimora/store/products/abandoned", hoursAgo(30));
    const staff = await signInWithPermissions([CustomPermission.CATALOG_PUBLISH]);

    const { status, body } = await run(staff);

    expect(status).toBe(200);
    expect(body.destroyed).toEqual(["mimora/store/products/abandoned"]);
  });

  it("NEGATIVE: an unauthenticated request is refused (401) and nothing is deleted", async () => {
    await pending("mimora/store/products/abandoned", hoursAgo(30));
    const { NextRequest } = await import("next/server");
    const { harnessCookieJar } = await import("../../test-support/admin-route-harness");
    harnessCookieJar.clear();

    const response = await cleanUp(new NextRequest(`http://localhost${PATH}`, { method: "POST" }), { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
    expect(provider.destroyed).toEqual([]);
    expect(await pendingIds()).toEqual(["mimora/store/products/abandoned"]);
    owner = await signInAsOwner();
  });
});
