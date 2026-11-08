import mongoose from "mongoose";
import { toMoney, type ImageAsset } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { CategoryModel } from "src/server/catalog/category.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/** The product gallery through `PUT /api/admin/products/:id`: validated records, the permission, variant galleries, the listing image, and the destroy after the write. */
const provider = vi.hoisted(() => ({
  destroyed: [] as string[],
  destroyAsset: async (publicId: string) => {
    provider.destroyed.push(publicId);
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

const updateRoute = ((await import("./[id]/route")) as unknown as Record<"PUT", RouteHandler>).PUT;
const variantRoute = ((await import("../variants/[id]/route")) as unknown as Record<"PUT", RouteHandler>).PUT;

const image = (publicId: string): ImageAsset => ({ provider: "cloudinary" as ImageAsset["provider"], publicId, secureUrl: `https://res.example/${publicId}.png`, format: "png", width: 400, height: 400, bytes: 1000 });
let owner: AdminCaller;
let productId: string;
let variantId: string;
const put = (images: unknown, caller = owner) => caller.call(updateRoute, `/api/admin/products/${productId}`, { method: "PUT", params: { id: productId }, body: { images } });

beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([removeHarnessStaff(), ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  provider.destroyed.length = 0;
  await Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);
  const category = await CategoryModel.create({ slug: "c", published: true });
  const product = await ProductModel.create({ name: { ar: "منتج", en: "P" }, description: { ar: "", en: "" }, slug: "p", categoryId: category._id, images: [image("mimora/store/products/a"), image("mimora/store/products/b")] });
  productId = product._id.toString();
  variantId = (await VariantModel.create({ productId: product._id, sku: "V", variantKey: `${productId}`, price: toMoney("5.00"), stock: 1, galleryOverride: [image("mimora/store/products/b")] }))._id.toString();
});

describe("product gallery", () => {
  it("saves the order the person chose, and the first image becomes the listing's primary", async () => {
    expect((await put([image("mimora/store/products/b"), image("mimora/store/products/a")])).status).toBe(200);
    const saved = await ProductModel.findById(productId).lean();
    expect(saved?.images.map((i) => i.publicId)).toEqual(["mimora/store/products/b", "mimora/store/products/a"]);
    expect(saved?.listing.primaryImage?.publicId).toBe("mimora/store/products/b");
    expect(provider.destroyed).toEqual([]);
  });

  it("removing an image takes it out of the variant that picked it, and destroys the file after the save", async () => {
    expect((await put([image("mimora/store/products/a")])).status).toBe(200);
    expect((await VariantModel.findById(variantId).lean())?.galleryOverride).toEqual([]);
    expect(provider.destroyed).toEqual(["mimora/store/products/b"]);
  });

  it("a variant may pick from the gallery through its own route", async () => {
    const response = await owner.call(variantRoute, `/api/admin/variants/${variantId}`, { method: "PUT", params: { id: variantId }, body: { galleryOverride: [image("mimora/store/products/a")] } });
    expect(response.status).toBe(200);
    expect((await VariantModel.findById(variantId).lean())?.galleryOverride?.map((i) => i.publicId)).toEqual(["mimora/store/products/a"]);
  });

  it.each([
    ["a record with no secureUrl", [{ publicId: "mimora/store/products/x" }]],
    ["a string", ["https://evil.example/x.png"]],
    ["more than 20 images", Array.from({ length: 21 }, (_, i) => image(`mimora/store/products/n${i}`))],
  ])("refuses %s with 400 and changes nothing", async (_label, images) => {
    expect((await put(images)).status).toBe(400);
    expect((await ProductModel.findById(productId).lean())?.images).toHaveLength(2);
    expect(provider.destroyed).toEqual([]);
  });

  it("Product.read alone cannot change the gallery (403), nothing destroyed", async () => {
    const reader = await signInWithPermissions([AppPermission.PRODUCT.READ, AppPermission.PRODUCT.READ_ONE]);
    expect((await put([], reader)).status).toBe(403);
    expect((await ProductModel.findById(productId).lean())?.images).toHaveLength(2);
    expect(provider.destroyed).toEqual([]);
  });
});
