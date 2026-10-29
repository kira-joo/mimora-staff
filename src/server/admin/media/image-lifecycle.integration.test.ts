import mongoose from "mongoose";
import { toMoney, type ImageAsset } from "@kira-joo/toolkit-common";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { categoryRepository, collectionRepository, storeProfileRepository } from "../../core/repositories";
import { failAfterWrite, restoreInjectedFailures } from "../../core/test-support/rollback-injection";
import { CategoryModel } from "../../catalog/category.schema";
import { CollectionModel } from "../../catalog/collection.schema";
import { ProductModel } from "../../catalog/product.schema";
import { StoreProfileModel } from "../../content/store-profile.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { updateProduct } from "../products/update-product";
import { updateCategory } from "../categories/update-category";
import { updateCollection } from "../collections/update-collection";
import { updateStoreProfile } from "../store-profile/update-store-profile";
import type { UpdateStoreProfileDto } from "../dto/update-store-profile.dto";

/**
 * A replaced or removed image is destroyed AFTER the write commits — never inside the transaction, never when it
 * rolls back, never an asset another document still shows, never one outside this application's namespace.
 */
const provider = vi.hoisted(() => ({
  destroyed: [] as string[],
  destroyAsset: async (publicId: string) => {
    provider.destroyed.push(publicId);
  },
}));
vi.mock("../../core/assets/asset-providers", () => ({ assetProvider: () => provider }));

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const image = (publicId: string): ImageAsset => ({
  provider: "cloudinary" as ImageAsset["provider"],
  publicId,
  secureUrl: `https://res.example/${publicId}.png`,
  format: "png",
  width: 400,
  height: 400,
  bytes: 1000,
});

let productId: string;
let variantId: string;

beforeAll(async () => {
  await connectToDatabase();
});
afterAll(async () => {
  await Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({}), CollectionModel.deleteMany({})]);
  await mongoose.disconnect();
});
beforeEach(async () => {
  provider.destroyed.length = 0;
  await Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({}), CollectionModel.deleteMany({})]);
  const category = await CategoryModel.create({ slug: "c", published: true });
  const product = await ProductModel.create({
    name: { ar: "منتج", en: "Product" },
    description: { ar: "", en: "" },
    slug: "p",
    categoryId: category._id,
    optionAxes: [{ key: "colour", name: { ar: "اللون", en: "Colour" } }],
    images: [image("store/products/a"), image("store/products/b")],
  });
  productId = product._id.toString();
  const variant = await VariantModel.create({
    productId: product._id,
    sku: "P-RED",
    variantKey: `${productId}|colour=red`,
    optionValues: [{ key: "colour", value: "red" }],
    price: toMoney("10.00"),
    stock: 3,
    galleryOverride: [image("store/products/b")],
  });
  variantId = variant._id.toString();
});

describe("product images", () => {
  it("destroys a removed image once the write has committed, and keeps the others", async () => {
    const updated = await updateProduct(productId, { images: [image("store/products/b")] });
    expect(updated.images.map((i) => i.publicId)).toEqual(["store/products/b"]);
    expect(provider.destroyed).toEqual(["store/products/a"]);
  });

  it("destroys nothing while the transaction is open, and nothing at all when it rolls back", async () => {
    await expect(
      withTransaction(async () => {
        await updateProduct(productId, { images: [image("store/products/b")] });
        // The write has happened inside the transaction, but has not committed: no destroy yet.
        expect(provider.destroyed).toEqual([]);
        throw new Error("a later step failed");
      })
    ).rejects.toThrow("a later step failed");

    expect(provider.destroyed).toEqual([]);
    expect((await ProductModel.findById(productId).lean())?.images.map((i) => i.publicId)).toEqual(["store/products/a", "store/products/b"]);
  });

  it("when the outer transaction commits, the destroy runs after it — once", async () => {
    await withTransaction(async (tx) => {
      await updateProduct(productId, { images: [image("store/products/b")] });
      expect(provider.destroyed).toEqual([]);
      return tx.complete(undefined);
    });
    expect(provider.destroyed).toEqual(["store/products/a"]);
  });

  it("a save that does not touch the gallery destroys nothing", async () => {
    await updateProduct(productId, { name: { ar: "جديد", en: "New" } });
    expect(provider.destroyed).toEqual([]);
  });

  it("an image removed from the product also leaves the variant gallery that picked it, and the listing image is recomputed", async () => {
    await updateProduct(productId, { images: [image("store/products/a")] });

    const variant = await VariantModel.findById(variantId).lean();
    expect(variant?.galleryOverride).toEqual([]);
    expect(provider.destroyed).toEqual(["store/products/b"]);
    expect((await ProductModel.findById(productId).lean())?.listing.primaryImage?.publicId).toBe("store/products/a");
  });

  it("an asset still shown by another document is not destroyed", async () => {
    await CategoryModel.create({ slug: "other", published: true, image: image("store/products/a") });
    await updateProduct(productId, { images: [image("store/products/b")] });
    expect(provider.destroyed).toEqual([]);
  });

  it("an asset outside this application's namespace is never destroyed, whatever a record claims", async () => {
    await ProductModel.updateOne({ _id: productId }, { $set: { images: [image("someone-elses/portrait")] } });
    await updateProduct(productId, { images: [] });
    expect(provider.destroyed).toEqual([]);
  });

  it("a storage failure while destroying is logged and does not fail the edit that already committed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const original = provider.destroyAsset;
    provider.destroyAsset = async () => {
      throw new Error("cloudinary is down");
    };
    try {
      const updated = await updateProduct(productId, { images: [image("store/products/b")] });
      expect(updated.images).toHaveLength(1);
      expect(log.mock.calls.flat().join(" ")).toMatch(/orphan/);
    } finally {
      provider.destroyAsset = original;
      log.mockRestore();
    }
  });
});

describe("category and collection images", () => {
  it.each([
    ["category", () => CategoryModel.create({ slug: "cat-img", published: true, image: image("store/categories/old") }), (id: string, input: { image?: ImageAsset | null }) => updateCategory(id, input), CategoryModel],
    ["collection", () => CollectionModel.create({ slug: "col-img", published: true, image: image("store/collections/old") }), (id: string, input: { image?: ImageAsset | null }) => updateCollection(id, input), CollectionModel],
  ] as const)("%s: replacing destroys the old asset, removing (null) unsets the field and destroys it, omitting touches nothing", async (name, create, update, Model) => {
    const doc = await create();
    const id = doc._id.toString();
    const oldId = `store/${name === "category" ? "categories" : "collections"}/old`;

    await update(id, {});
    expect(provider.destroyed).toEqual([]);

    await update(id, { image: image(`${oldId}-new`) });
    expect(provider.destroyed).toEqual([oldId]);

    provider.destroyed.length = 0;
    await update(id, { image: null });
    expect(provider.destroyed).toEqual([`${oldId}-new`]);
    const stored = (await (Model as typeof CategoryModel).collection.findOne({ _id: doc._id })) as Record<string, unknown>;
    expect("image" in stored).toBe(false);
  });
});

/**
 * The three single-write updates that open a transaction only so a replaced image is destroyed AFTER commit. What
 * these prove is that the write really is inside the transaction: remove `withTransaction` and the edit survives the
 * failure that follows it. (That the destroy is deferred is NOT separately provable from outside: a rolled-back edit
 * leaves the old image referenced, so `destroyUnreferencedImages` would skip it anyway — a second guard, not a second
 * test. Product images, whose destroy is also reachable by an outer rollback, are covered above.)
 */
describe("single-write image updates roll back whole, and destroy nothing when they do", () => {
  afterEach(restoreInjectedFailures);

  const cases = [
    {
      name: "category",
      Model: CategoryModel,
      repository: categoryRepository,
      seed: () => CategoryModel.create({ slug: "rb-cat", published: true, image: image("store/categories/keep") }),
      update: (id: string) => updateCategory(id, { slug: "renamed", image: null }),
    },
    {
      name: "collection",
      Model: CollectionModel,
      repository: collectionRepository,
      seed: () => CollectionModel.create({ slug: "rb-col", published: true, image: image("store/collections/keep") }),
      update: (id: string) => updateCollection(id, { slug: "renamed", image: null }),
    },
    {
      name: "store profile",
      Model: StoreProfileModel,
      repository: storeProfileRepository,
      seed: () => StoreProfileModel.create({ currency: "EGP", contact: { phone: "+201000000000", email: "hello@example.com" }, logo: image("store/brand/keep") }),
      update: (_id: string) => updateStoreProfile({ logo: null, tagline: { ar: "جديد", en: "New" } } as unknown as UpdateStoreProfileDto),
    },
  ] as const;

  beforeEach(async () => {
    await StoreProfileModel.deleteMany({});
  });

  it.each(cases)("$name: a failure after the write leaves the record untouched and destroys no asset", async ({ Model, repository, seed, update }) => {
    const doc = await seed();
    const before = await (Model as typeof CategoryModel).collection.findOne({ _id: doc._id });
    const write = failAfterWrite(repository, "updateAtomic", 1); // the edit lands inside the transaction, then throws

    await expect(update(doc._id.toString())).rejects.toThrow("injected failure");

    expect(write.calls).toBe(1);
    expect(await (Model as typeof CategoryModel).collection.findOne({ _id: doc._id })).toEqual(before);
    expect(provider.destroyed).toEqual([]);
  });
});
