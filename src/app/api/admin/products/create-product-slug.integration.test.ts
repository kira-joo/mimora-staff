import mongoose from "mongoose";
import { toMoney, type ImageAsset } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { connectToDatabase } from "src/server/core/db/connect";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { CategoryModel } from "src/server/catalog/category.schema";
import { CollectionModel } from "src/server/catalog/collection.schema";
import { ProductModel } from "src/server/catalog/product.schema";
import { VariantModel } from "src/server/catalog/variant.schema";
import { createProduct } from "src/server/admin/products/create-product";
import { cloneProductValues } from "src/features/catalog/products/product-autofill";
import type { Product } from "src/api/products.endpoints";
import { removeHarnessStaff, signInAsOwner, signInWithPermissions, type AdminCaller, type RouteHandler } from "../test-support/admin-route-harness";

/**
 * Creating a product from the console (`POST /api/admin/products`): a taken slug is suffixed instead of refused, and a
 * create built from a clone of another product carries its content but nothing else — no variants, images, prices,
 * stock or lifecycle — and leaves the source exactly as it was. Catalog import keeps the 409 (it matches by slug).
 */
vi.mock("next/headers", async () => {
  const { harnessCookieJar } = await import("../test-support/admin-route-harness");
  return { cookies: async () => ({ set: () => undefined, get: (name: string) => (harnessCookieJar.has(name) ? { name, value: harnessCookieJar.get(name)! } : undefined) }) };
});

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";
process.env.STAFF_JWT_SECRET ??= "test-staff-secret-at-least-32-characters-long";

const routes = (await import("./route")) as unknown as Record<"POST" | "GET", RouteHandler>;
const getOne = ((await import("./[id]/route")) as unknown as Record<"GET", RouteHandler>).GET;

const L = (en: string, ar: string) => ({ en, ar });
const image = (publicId: string): ImageAsset => ({ provider: "cloudinary" as ImageAsset["provider"], publicId, secureUrl: `https://res.example/${publicId}.png`, format: "png", width: 400, height: 400, bytes: 1000 });

let owner: AdminCaller;
let categoryId: string;
let collectionIds: string[];

const wipe = () => Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({}), CollectionModel.deleteMany({})]);
beforeAll(async () => {
  await connectToDatabase();
  owner = await signInAsOwner();
});
afterAll(async () => {
  await Promise.all([wipe(), removeHarnessStaff()]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  await wipe();
  categoryId = (await CategoryModel.create({ slug: "necklaces", published: true }))._id.toString();
  collectionIds = (await CollectionModel.create([{ slug: "gifts", name: L("Gifts", "هدايا") }, { slug: "gold", name: L("Gold", "ذهب") }])).map((c) => c._id.toString());
});

const body = (slug: string, extra: Record<string, unknown> = {}) => ({
  name: L("Golden Heart Pendant Necklace", "سلسلة بدلاية قلب ذهبي"),
  description: L("", ""),
  slug,
  categoryId,
  collectionIds: [],
  optionAxes: [],
  attributes: [],
  seoTitle: L("Golden Heart Pendant Necklace | Mimora", "سلسلة بدلاية قلب ذهبي | Mimora"),
  seoDescription: L("", ""),
  ...extra,
});
const create = async (payload: unknown, caller: AdminCaller = owner) => {
  const response = await caller.call(routes.POST, "/api/admin/products", { method: "POST", body: payload });
  return { status: response.status, product: (await response.json()) as Product & { message?: string } };
};

describe("console create — slug", () => {
  it("keeps a free slug as sent", async () => {
    const { status, product } = await create(body("golden-heart-pendant-necklace"));
    expect(status).toBeLessThan(300);
    expect(product.slug).toBe("golden-heart-pendant-necklace");
  });

  it("suffixes a taken slug -2, then -3, instead of refusing", async () => {
    await create(body("golden-heart-pendant-necklace"));
    const second = await create(body("golden-heart-pendant-necklace"));
    const third = await create(body("golden-heart-pendant-necklace"));

    expect(second.status).toBeLessThan(300);
    expect(second.product.slug).toBe("golden-heart-pendant-necklace-2");
    expect(third.product.slug).toBe("golden-heart-pendant-necklace-3");
    expect((await ProductModel.find({}).lean()).map((p) => p.slug).sort()).toEqual(["golden-heart-pendant-necklace", "golden-heart-pendant-necklace-2", "golden-heart-pendant-necklace-3"]);
  });

  it("a slug that only starts the same way does not count as taken", async () => {
    await create(body("golden-heart-pendant-necklace-gold"));
    expect((await create(body("golden-heart-pendant-necklace"))).product.slug).toBe("golden-heart-pendant-necklace");
  });

  it("catalog import's path (the service default) still refuses a taken slug with 409", async () => {
    await create(body("golden-heart"));
    await expect(createProduct({ name: L("X", "س"), description: L("", ""), slug: "golden-heart", categoryId })).rejects.toThrow(ConflictError);
    expect(await ProductModel.countDocuments({ slug: /^golden-heart/ })).toBe(1);
  });

  it("NEGATIVE: without Product.create the request is refused and nothing is written", async () => {
    const reader = await signInWithPermissions([AppPermission.PRODUCT.READ, AppPermission.PRODUCT.READ_ONE]);
    expect((await create(body("golden-heart"), reader)).status).toBe(403);
    expect(await ProductModel.countDocuments({})).toBe(0);
    owner = await signInAsOwner();
  });
});

describe("console create — from a clone", () => {
  const seedSource = async () => {
    const source = await ProductModel.create({
      name: L("Golden Heart Pendant Necklace", "سلسلة بدلاية قلب ذهبي"),
      description: L("A heart pendant.", "قلادة قلب."),
      slug: "golden-heart-pendant-necklace",
      categoryId,
      collectionIds,
      images: [image("mimora/store/products/heart")],
      optionAxes: [{ key: "length", name: L("Length", "الطول"), values: [{ key: "45", label: L("45 cm", "45 سم") }] }],
      attributes: [
        { key: "material", name: L("Material", "الخامة"), values: [{ key: "gold", value: L("Gold", "ذهب") }] },
        { key: "stone", name: L("Stone", "الحجر"), values: [{ key: "zircon", value: L("Zircon", "زركون") }, { key: "pearl", value: L("Pearl", "لؤلؤ") }] },
      ],
      seoTitle: L("", ""),
      seoDescription: L("Shop the heart.", "تسوقي القلب."),
      lifecycle: "draft",
      order: 7,
    });
    await VariantModel.create({ productId: source._id, sku: "GHP-45", variantKey: "length:45", optionValues: [{ key: "length", value: "45" }], price: toMoney("250.00"), stock: 4 });
    return source._id.toString();
  };

  it("creates a separate draft with the source's content and none of its variants, SKUs, prices, stock or images; the source is unchanged", async () => {
    const sourceId = await seedSource();
    const sourceBefore = await ProductModel.findById(sourceId).lean();
    const variantsBefore = await VariantModel.find({}).lean();

    // What the console does: GET the source, build the form from it, edit, POST the form's values.
    const fetched = (await (await owner.call(getOne, `/api/admin/products/${sourceId}`, { params: { id: sourceId } })).json()) as Product;
    const values = cloneProductValues(fetched);
    values.name.en = "Silver Heart Pendant Necklace";
    values.attributes[0]!.values[0]!.value = L("Silver", "فضة");
    values.collectionIds = [collectionIds[0]!];
    const { status, product } = await create({ ...values, brandId: undefined, sizeGuide: undefined });

    expect(status).toBeLessThan(300);
    expect(product._id).not.toBe(sourceId);
    expect(product.lifecycle).toBe("draft");
    expect(product.images ?? []).toEqual([]);
    expect(product.order).toBe(0);
    expect(product.collectionIds).toEqual([collectionIds[0]]);
    expect(product.attributes.map((a) => [a.key, a.values.map((v) => v.value.en)])).toEqual([
      ["material", ["Silver"]],
      ["stone", ["Zircon", "Pearl"]],
    ]);
    expect(product.optionAxes.map((a) => a.key)).toEqual(["length"]);
    expect(product.seoDescription).toEqual(L("Shop the heart.", "تسوقي القلب."));
    expect(product.listing.purchasableVariantCount).toBe(0);
    expect(product.listing.minActivePrice).toBeUndefined();
    expect(await VariantModel.countDocuments({ productId: product._id })).toBe(0);

    expect(await ProductModel.findById(sourceId).lean()).toEqual(sourceBefore);
    expect(await VariantModel.find({}).lean()).toEqual(variantsBefore);
  });

  it("an unedited clone keeps the source's slug as its base and is saved as -2", async () => {
    const sourceId = await seedSource();
    const fetched = (await (await owner.call(getOne, `/api/admin/products/${sourceId}`, { params: { id: sourceId } })).json()) as Product;
    const { product } = await create({ ...cloneProductValues(fetched), brandId: undefined, sizeGuide: undefined });
    expect(product.slug).toBe("golden-heart-pendant-necklace-2");
    expect(product.seoTitle).toEqual(L("Golden Heart Pendant Necklace | Mimora", "سلسلة بدلاية قلب ذهبي | Mimora"));
  });
});
