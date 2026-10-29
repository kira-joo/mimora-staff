import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CollectionModel } from "../../catalog/collection.schema";
import { listCollections } from "./list-collections";
import { createCollection } from "./create-collection";
import { updateCollection } from "./update-collection";
import { reorderCollections } from "./reorder-collections";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "نص", en: "Text" };

describe("Admin Collections", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await CollectionModel.deleteMany({});
  });

  describe("createCollection", () => {
    it("creates a collection with required fields", async () => {
      const collection = await createCollection({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "sale",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      expect(collection.slug).toBe("sale");
      expect(collection.published).toBe(false);
      expect(collection.sortOrder).toBe(0);
    });

    it("throws ConflictError on duplicate slug", async () => {
      await createCollection({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "dup",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      await expect(
        createCollection({
          name: LOCALIZED,
          description: LOCALIZED,
          slug: "dup",
          seoTitle: LOCALIZED,
          seoDescription: LOCALIZED,
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("updateCollection", () => {
    it("updates fields and can publish", async () => {
      const created = await createCollection({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "to-update",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      const updated = await updateCollection(created._id.toString(), { published: true, sortOrder: 3 });
      expect(updated.published).toBe(true);
      expect(updated.sortOrder).toBe(3);
    });

    it("throws ConflictError when updating to a duplicate slug", async () => {
      await createCollection({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "one",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      const other = await createCollection({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "two",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      await expect(updateCollection(other._id.toString(), { slug: "one" })).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent collection", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(updateCollection(fakeId, { sortOrder: 1 })).rejects.toThrow(NotFoundError);
    });
  });

  describe("listCollections", () => {
    it("filters by published", async () => {
      await createCollection({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "pub",
        published: true,
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      await createCollection({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "unpub",
        published: false,
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      const published = await listCollections({ limit: 10, page: 1, published: true });
      expect(published.total).toBe(1);

      const all = await listCollections({ limit: 10, page: 1 });
      expect(all.total).toBe(2);
    });
  });

  describe("reorderCollections", () => {
    it("bulk-updates sortOrder", async () => {
      const a = await createCollection({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "order-a",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      const b = await createCollection({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "order-b",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      await reorderCollections({
        items: [
          { collectionId: a._id.toString(), sortOrder: 2 },
          { collectionId: b._id.toString(), sortOrder: 1 },
        ],
      });

      const updatedA = await CollectionModel.findById(a._id).lean();
      const updatedB = await CollectionModel.findById(b._id).lean();
      expect(updatedA?.sortOrder).toBe(2);
      expect(updatedB?.sortOrder).toBe(1);
    });
  });
});
