import { SortOrder } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { listCategories } from "./list-categories";
import { createCategory } from "./create-category";
import { updateCategory } from "./update-category";
import { reorderCategories } from "./reorder-categories";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "نص", en: "Text" };

describe("Admin Categories", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await CategoryModel.deleteMany({});
  });

  describe("createCategory", () => {
    it("creates a category with required fields", async () => {
      const category = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "test-category",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      expect(category.slug).toBe("test-category");
      expect(category.published).toBe(false);
      expect(category.sortOrder).toBe(0);
      expect(category.parentId).toBeUndefined();
    });

    it("creates a child category under an existing parent", async () => {
      const parent = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "parent",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      const child = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "child",
        parentId: parent._id.toString(),
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      expect(child.parentId?.toString()).toBe(parent._id.toString());
    });

    it("throws NotFoundError for a non-existent parent", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(
        createCategory({
          name: LOCALIZED,
          description: LOCALIZED,
          slug: "orphan",
          parentId: fakeId,
          seoTitle: LOCALIZED,
          seoDescription: LOCALIZED,
        })
      ).rejects.toThrow(NotFoundError);
    });

    it("throws ConflictError on duplicate slug", async () => {
      await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "dup",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      await expect(
        createCategory({
          name: LOCALIZED,
          description: LOCALIZED,
          slug: "dup",
          seoTitle: LOCALIZED,
          seoDescription: LOCALIZED,
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("updateCategory", () => {
    it("updates fields and can publish", async () => {
      const created = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "to-update",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      const updated = await updateCategory(created._id.toString(), { published: true, sortOrder: 5 });
      expect(updated.published).toBe(true);
      expect(updated.sortOrder).toBe(5);
    });

    it("moves a category to a new parent", async () => {
      const parentA = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "parent-a",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      const parentB = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "parent-b",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      const child = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "movable-child",
        parentId: parentA._id.toString(),
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      const moved = await updateCategory(child._id.toString(), { parentId: parentB._id.toString() });
      expect(moved.parentId?.toString()).toBe(parentB._id.toString());
    });

    it("clears the parent when parentId is explicitly null", async () => {
      const parent = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "parent-c",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      const child = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "child-c",
        parentId: parent._id.toString(),
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      const cleared = await updateCategory(child._id.toString(), { parentId: null });
      expect(cleared.parentId).toBeUndefined();
    });

    it("throws ConflictError when a category is moved under its own descendant", async () => {
      const grandparent = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "gp",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      const parent = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "p",
        parentId: grandparent._id.toString(),
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      await expect(
        updateCategory(grandparent._id.toString(), { parentId: parent._id.toString() })
      ).rejects.toThrow(ConflictError);
    });

    it("throws ConflictError when a category is set as its own parent", async () => {
      const created = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "self-parent",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      await expect(
        updateCategory(created._id.toString(), { parentId: created._id.toString() })
      ).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent category", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(updateCategory(fakeId, { sortOrder: 1 })).rejects.toThrow(NotFoundError);
    });
  });

  describe("listCategories", () => {
    it("defaults to sortOrder ascending rather than newest first, and still honours an explicit sortBy", async () => {
      await CategoryModel.create({ slug: "sorted-first", sortOrder: 1 });
      await CategoryModel.create({ slug: "sorted-second", sortOrder: 2 });

      const byDefault = await listCategories({ page: 1, limit: 10 });
      expect(byDefault.data.map((category) => category.slug)).toEqual(["sorted-first", "sorted-second"]);

      const explicit = await listCategories({ page: 1, limit: 10, sortBy: "slug", sortOrder: SortOrder.DESC });
      expect(explicit.data.map((category) => category.slug)).toEqual(["sorted-second", "sorted-first"]);
    });

    it("filters by parentId and published", async () => {
      const parent = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "list-parent",
        published: true,
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "list-child-1",
        parentId: parent._id.toString(),
        published: true,
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "list-child-2",
        parentId: parent._id.toString(),
        published: false,
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      const children = await listCategories({ limit: 10, page: 1, parentId: parent._id.toString() });
      expect(children.total).toBe(2);

      const publishedChildren = await listCategories({
        limit: 10,
        page: 1,
        parentId: parent._id.toString(),
        published: true,
      });
      expect(publishedChildren.total).toBe(1);
    });
  });

  describe("reorderCategories", () => {
    it("bulk-updates sortOrder", async () => {
      const a = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "order-a",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });
      const b = await createCategory({
        name: LOCALIZED,
        description: LOCALIZED,
        slug: "order-b",
        seoTitle: LOCALIZED,
        seoDescription: LOCALIZED,
      });

      await reorderCategories({
        items: [
          { categoryId: a._id.toString(), sortOrder: 2 },
          { categoryId: b._id.toString(), sortOrder: 1 },
        ],
      });

      const updatedA = await CategoryModel.findById(a._id).lean();
      const updatedB = await CategoryModel.findById(b._id).lean();
      expect(updatedA?.sortOrder).toBe(2);
      expect(updatedB?.sortOrder).toBe(1);
    });
  });
});
