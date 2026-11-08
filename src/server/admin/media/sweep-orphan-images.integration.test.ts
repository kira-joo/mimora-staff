import mongoose from "mongoose";
import { toMoney, type ImageAsset } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { PendingUploadModel } from "../../catalog/pending-upload.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { sweepOrphanImages } from "./sweep-orphan-images";

/**
 * The orphan sweep, against a stub provider whose call log is the assertion: an upload that a document references is
 * kept, an old one nothing references is destroyed, a young one is left alone, and nothing outside the application's
 * namespace is ever destroyed.
 */
const provider = vi.hoisted(() => ({
  destroyed: [] as string[],
  failFor: new Set<string>(),
  destroyAsset: async (publicId: string) => {
    if (provider.failFor.has(publicId)) throw new Error("provider down");
    provider.destroyed.push(publicId);
  },
}));
vi.mock("../../core/assets/asset-providers", () => ({ assetProvider: () => provider }));

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-10-24T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

const image = (publicId: string): ImageAsset => ({ provider: "cloudinary" as ImageAsset["provider"], publicId, secureUrl: `https://res.example/${publicId}.png`, format: "png", width: 400, height: 400, bytes: 1000 });
const pending = (publicId: string, createdAt: Date) => PendingUploadModel.collection.insertOne({ publicId, createdAt, updatedAt: createdAt });
const pendingIds = async () => (await PendingUploadModel.find({}).lean()).map((row) => row.publicId).sort();

const clean = () => Promise.all([PendingUploadModel.deleteMany({}), ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);
beforeAll(connectToDatabase);
afterAll(async () => {
  await clean();
  await mongoose.disconnect();
});
beforeEach(async () => {
  provider.destroyed.length = 0;
  provider.failFor.clear();
  await clean();
});

async function seedProductWith(publicId: string) {
  const category = await CategoryModel.create({ slug: "c", published: true });
  const product = await ProductModel.create({ slug: "p", categoryId: category._id, lifecycle: "published", name: { en: "P", ar: "م" }, images: [image(publicId)] });
  await VariantModel.create({ productId: product._id, sku: "P-1", variantKey: "p-1", price: toMoney("1.00"), stock: 1 });
}

describe("sweepOrphanImages", () => {
  it("destroys an old upload nothing references, and forgets it", async () => {
    await pending("mimora/store/products/orphan", ago(30));

    const result = await sweepOrphanImages(NOW);

    expect(result).toEqual({ examined: 1, kept: 0, destroyed: ["mimora/store/products/orphan"], failed: [] });
    expect(provider.destroyed).toEqual(["mimora/store/products/orphan"]);
    expect(await pendingIds()).toEqual([]);
  });

  it("keeps an old upload a document references — and stops tracking it", async () => {
    await seedProductWith("mimora/store/products/saved");
    await pending("mimora/store/products/saved", ago(30));

    const result = await sweepOrphanImages(NOW);

    expect(result).toMatchObject({ examined: 1, kept: 1, destroyed: [] });
    expect(provider.destroyed).toEqual([]);
    expect(await pendingIds()).toEqual([]);
  });

  it("leaves a young upload alone, destroying nothing and keeping the row", async () => {
    await pending("mimora/store/products/young", ago(23));

    const result = await sweepOrphanImages(NOW);

    expect(result.examined).toBe(0);
    expect(provider.destroyed).toEqual([]);
    expect(await pendingIds()).toEqual(["mimora/store/products/young"]);
  });

  it("handles all three at once", async () => {
    await seedProductWith("mimora/store/products/saved");
    await pending("mimora/store/products/saved", ago(48));
    await pending("mimora/store/products/orphan", ago(25));
    await pending("mimora/store/products/young", ago(1));

    const result = await sweepOrphanImages(NOW);

    expect(result.destroyed).toEqual(["mimora/store/products/orphan"]);
    expect(result.kept).toBe(1);
    expect(await pendingIds()).toEqual(["mimora/store/products/young"]);
  });

  it("never destroys an asset outside this application's namespace", async () => {
    await pending("other-app/products/foreign", ago(30));

    const result = await sweepOrphanImages(NOW);

    expect(provider.destroyed).toEqual([]);
    expect(result.destroyed).toEqual([]);
    expect(await pendingIds()).toEqual([]);
  });

  it("a provider failure leaves the row for the next run and does not stop the others", async () => {
    await pending("mimora/store/products/stuck", ago(40));
    await pending("mimora/store/products/fine", ago(30));
    provider.failFor.add("mimora/store/products/stuck");

    const first = await sweepOrphanImages(NOW);
    expect(first.failed).toEqual(["mimora/store/products/stuck"]);
    expect(first.destroyed).toEqual(["mimora/store/products/fine"]);
    expect(await pendingIds()).toEqual(["mimora/store/products/stuck"]);

    provider.failFor.clear();
    const second = await sweepOrphanImages(NOW);
    expect(second.destroyed).toEqual(["mimora/store/products/stuck"]);
    expect(await pendingIds()).toEqual([]);
  });

  it("is idempotent: a second run has nothing to do", async () => {
    await pending("mimora/store/products/orphan", ago(30));
    await sweepOrphanImages(NOW);
    provider.destroyed.length = 0;

    expect(await sweepOrphanImages(NOW)).toEqual({ examined: 0, kept: 0, destroyed: [], failed: [] });
    expect(provider.destroyed).toEqual([]);
  });

  it("works through a backlog in batches, oldest first", async () => {
    await pending("mimora/store/products/a", ago(50));
    await pending("mimora/store/products/b", ago(40));
    await pending("mimora/store/products/c", ago(30));

    const first = await sweepOrphanImages(NOW, { batchSize: 2 });
    expect(first.destroyed).toEqual(["mimora/store/products/a", "mimora/store/products/b"]);
    const second = await sweepOrphanImages(NOW, { batchSize: 2 });
    expect(second.destroyed).toEqual(["mimora/store/products/c"]);
  });
});
