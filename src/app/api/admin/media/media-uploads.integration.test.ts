import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";
import { PendingUploadModel } from "src/server/catalog/pending-upload.schema";
import { imageForm, makePng } from "../test-support/image-fixtures";

/**
 * The public-image upload routes, as Next calls them: real auth, real multipart parsing, the real policy
 * validators reading the real bytes. Only the storage provider is a recording stub — no Cloudinary is
 * contacted — so "nothing was uploaded" is an assertion about the stub's call log, not an assumption.
 */
const provider = vi.hoisted(() => ({
  uploads: [] as Array<{ folder: string; bytes: number }>,
  uploadImage: async (buffer: Buffer, options: { folder: string }) => {
    provider.uploads.push({ folder: options.folder, bytes: buffer.length });
    const id = `${options.folder}/fake-${provider.uploads.length}`;
    return { provider: "cloudinary", publicId: id, secureUrl: `https://res.example/${id}.png`, format: "png", width: 300, height: 300, bytes: buffer.length };
  },
}));
vi.mock("src/server/core/assets/asset-providers", () => ({ assetProvider: () => provider }));
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const postProduct = (await import("./product-images/route")).POST as RouteHandler;
const postCategory = (await import("./category-images/route")).POST as RouteHandler;
const postCollection = (await import("./collection-images/route")).POST as RouteHandler;
const postStoreProfile = (await import("./store-profile-images/route")).POST as RouteHandler;

let owner: AdminCaller;

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await removeHarnessStaff();
  await mongoose.disconnect();
});
beforeEach(async () => {
  provider.uploads.length = 0;
  await PendingUploadModel.deleteMany({});
});

const upload = (handler: RouteHandler, path: string, form: FormData, caller = owner) => caller.call(handler, path, { method: "POST", body: form });

describe("catalog image uploads", () => {
  it.each([
    ["product", postProduct, "/api/admin/media/product-images", "store/products"],
    ["category", postCategory, "/api/admin/media/category-images", "store/categories"],
    ["collection", postCollection, "/api/admin/media/collection-images", "store/collections"],
  ])("a %s image is stored in its own folder and answers the ImageAsset", async (_name, handler, path, folder) => {
    const response = await upload(handler, path, imageForm(makePng(300, 300)));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ provider: "cloudinary", publicId: expect.stringMatching(new RegExp(`^${folder}/`)), secureUrl: expect.stringContaining("https://"), width: 300, height: 300 });
    expect(provider.uploads).toHaveLength(1);
    expect(provider.uploads[0]?.folder).toBe(folder);
  });

  it("records every accepted upload as pending for the orphan sweep — and a refused one leaves nothing", async () => {
    const accepted = await upload(postProduct, "/api/admin/media/product-images", imageForm(makePng(300, 300)));
    const { publicId } = (await accepted.json()) as { publicId: string };
    expect((await PendingUploadModel.find({}).lean()).map((row) => row.publicId)).toEqual([publicId]);

    await upload(postProduct, "/api/admin/media/product-images", imageForm(makePng(100, 100)));
    expect(await PendingUploadModel.countDocuments()).toBe(1);
  });

  it("refuses a type outside the policy (a GIF label) with 400 and uploads nothing", async () => {
    const response = await upload(postProduct, "/api/admin/media/product-images", imageForm(makePng(300, 300), { mimeType: "image/gif", filename: "a.gif" }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/Unsupported file type/);
    expect(provider.uploads).toHaveLength(0);
  });

  it("refuses an oversize file (over 8 MB) with 400 and uploads nothing", async () => {
    const response = await upload(postProduct, "/api/admin/media/product-images", imageForm(makePng(300, 300, 8 * 1024 * 1024 + 1)));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/too large/);
    expect(provider.uploads).toHaveLength(0);
  });

  it("refuses an image below the minimum dimensions", async () => {
    const response = await upload(postProduct, "/api/admin/media/product-images", imageForm(makePng(100, 100)));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toMatch(/below the minimum/);
    expect(provider.uploads).toHaveLength(0);
  });

  it("reads the bytes, not the label: text labelled image/png is refused", async () => {
    const response = await upload(postProduct, "/api/admin/media/product-images", imageForm(Buffer.from("definitely not an image at all, just words"), { mimeType: "image/png" }));
    expect(response.status).toBe(400);
    expect(provider.uploads).toHaveLength(0);
  });

  it("refuses a request with no file", async () => {
    const form = new FormData();
    form.append("note", "hello");
    expect((await upload(postProduct, "/api/admin/media/product-images", form)).status).toBe(400);
    expect(provider.uploads).toHaveLength(0);
  });
});

describe("store-profile image uploads", () => {
  it("holds each slot to its own policy and answers the ImageAsset", async () => {
    const logo = await upload(postStoreProfile, "/api/admin/media/store-profile-images", imageForm(makePng(128, 128), { fields: { slot: "logo" } }));
    expect(logo.status).toBe(201);
    expect(provider.uploads[0]?.folder).toBe("store/store-profile");

    const favicon = await upload(postStoreProfile, "/api/admin/media/store-profile-images", imageForm(makePng(48, 48), { fields: { slot: "favicon" } }));
    expect(favicon.status).toBe(201);
  });

  it("the favicon is held to a smaller ceiling than a hero: 2000px is refused for one and accepted for the other", async () => {
    const big = makePng(2000, 2000);
    expect((await upload(postStoreProfile, "/api/admin/media/store-profile-images", imageForm(big, { fields: { slot: "favicon" } }))).status).toBe(400);
    expect((await upload(postStoreProfile, "/api/admin/media/store-profile-images", imageForm(big, { fields: { slot: "heroMedia" } }))).status).toBe(201);
    expect(provider.uploads).toHaveLength(1);
  });

  it.each([[{}], [{ slot: "banner" }], [{ slot: "defaultSeo.ogImage" }]])("refuses a missing or unknown slot %j", async (fields) => {
    const response = await upload(postStoreProfile, "/api/admin/media/store-profile-images", imageForm(makePng(300, 300), { fields }));
    expect(response.status).toBe(400);
    expect(provider.uploads).toHaveLength(0);
  });
});

describe("who may upload — the negative cases", () => {
  const png = () => imageForm(makePng(300, 300));

  it.each([
    ["read-only access to products", [AppPermission.PRODUCT.READ, AppPermission.PRODUCT.READ_ONE], postProduct, "/api/admin/media/product-images"],
    ["category rights on the product route", [AppPermission.CATEGORY.CREATE, AppPermission.CATEGORY.UPDATE], postProduct, "/api/admin/media/product-images"],
    ["product rights on the category route", [AppPermission.PRODUCT.CREATE, AppPermission.PRODUCT.UPDATE], postCategory, "/api/admin/media/category-images"],
    ["product rights on the collection route", [AppPermission.PRODUCT.UPDATE], postCollection, "/api/admin/media/collection-images"],
    ["read-only access to the store profile", [AppPermission.STORE_PROFILE.READ], postStoreProfile, "/api/admin/media/store-profile-images"],
    ["catalog rights on the store-profile route", [AppPermission.PRODUCT.UPDATE, AppPermission.CATEGORY.UPDATE], postStoreProfile, "/api/admin/media/store-profile-images"],
  ])("%s is refused (403) and nothing is uploaded", async (_label, keys, handler, path) => {
    const staff = await signInWithPermissions(keys);
    const form = path.includes("store-profile") ? imageForm(makePng(300, 300), { fields: { slot: "logo" } }) : png();
    const response = await upload(handler, path, form, staff);
    expect(response.status).toBe(403);
    expect(provider.uploads).toHaveLength(0);
  });

  it("Product.create alone is enough — a new product has to carry an image before it exists", async () => {
    const staff = await signInWithPermissions([AppPermission.PRODUCT.CREATE]);
    expect((await upload(postProduct, "/api/admin/media/product-images", png(), staff)).status).toBe(201);
  });

  it("Product.update alone is enough on the product route", async () => {
    const staff = await signInWithPermissions([AppPermission.PRODUCT.UPDATE]);
    expect((await upload(postProduct, "/api/admin/media/product-images", png(), staff)).status).toBe(201);
  });

  it("an unauthenticated request is refused (401)", async () => {
    const { NextRequest } = await import("next/server");
    const { harnessCookieJar } = await import("../test-support/admin-route-harness");
    harnessCookieJar.clear();
    const response = await postProduct(new NextRequest("http://localhost/api/admin/media/product-images", { method: "POST", body: png() }), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
    expect(provider.uploads).toHaveLength(0);
    owner = await signInAsOwner();
  });
});
