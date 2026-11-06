import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { PromotionModel } from "../../commerce/promotion.schema";
import { StorefrontContentModel } from "../../content/storefront-content.schema";
import { createCategory } from "./create-category";
import { updateCategory } from "./update-category";
import { deleteCategory } from "./delete-category";
import { MAX_CATEGORY_DEPTH } from "./category-hierarchy";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "نص", en: "Text" };
let counter = 0;
const make = (parent?: { _id: mongoose.Types.ObjectId }, published = false) =>
  createCategory({ name: LOCALIZED, description: LOCALIZED, slug: `c-${(counter += 1)}`, parentId: parent?._id.toString(), published, seoTitle: LOCALIZED, seoDescription: LOCALIZED });
const id = (category: { _id: mongoose.Types.ObjectId }) => category._id.toString();
const stored = (category: { _id: mongoose.Types.ObjectId }) => CategoryModel.findById(category._id).lean();
/** `level` categories deep, root first: levels 1..level, each the child of the one before. */
async function chain(level: number, published = false) {
  const nodes = [await make(undefined, published)];
  for (let i = 1; i < level; i += 1) nodes.push(await make(nodes[i - 1], published));
  return nodes;
}

describe("category hierarchy rules", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
  beforeEach(async () => {
    await Promise.all([CategoryModel.deleteMany({}), ProductModel.collection.deleteMany({}), PromotionModel.collection.deleteMany({}), StorefrontContentModel.collection.deleteMany({})]);
  });

  describe("rule 1 — a published child always has a published parent", () => {
    it("refuses to publish a child whose parent is unpublished, and leaves it unpublished", async () => {
      const parent = await make();
      const child = await make(parent);
      await expect(updateCategory(id(child), { published: true })).rejects.toThrow(/can't be published while its parent is unpublished/);
      await expect(updateCategory(id(child), { published: true })).rejects.toThrow(ConflictError);
      expect((await stored(child))?.published).toBe(false);
    });

    it("allows publishing the child once the parent is published", async () => {
      const parent = await make();
      const child = await make(parent);
      await updateCategory(id(parent), { published: true });
      expect((await updateCategory(id(child), { published: true })).published).toBe(true);
    });

    it("refuses to create a published category under an unpublished parent, and stores nothing", async () => {
      const parent = await make();
      await expect(make(parent, true)).rejects.toThrow(/needs a published parent/);
      expect(await CategoryModel.countDocuments()).toBe(1);
    });

    it("allows creating published under a published parent, and unpublished under an unpublished one", async () => {
      const publishedParent = await make(undefined, true);
      const draftParent = await make();
      expect((await make(publishedParent, true)).published).toBe(true);
      expect((await make(draftParent, false)).published).toBe(false);
    });

    it("refuses to move a published category under an unpublished parent, and leaves it where it was", async () => {
      const home = await make(undefined, true);
      const moving = await make(home, true);
      const draftParent = await make();
      await expect(updateCategory(id(moving), { parentId: id(draftParent) })).rejects.toThrow(/published category can't be moved under an unpublished parent/);
      expect((await stored(moving))?.parentId?.toString()).toBe(id(home));
    });

    it("refuses a move that also publishes under an unpublished parent", async () => {
      const draftParent = await make();
      const moving = await make();
      await expect(updateCategory(id(moving), { parentId: id(draftParent), published: true })).rejects.toThrow(ConflictError);
    });

    it("allows moving: unpublished under unpublished, published under published, unpublish-and-move together, and anything to the top level", async () => {
      const draftParent = await make();
      const liveParent = await make(undefined, true);
      const draft = await make();
      const live = await make(undefined, true);

      expect((await updateCategory(id(draft), { parentId: id(draftParent) })).parentId?.toString()).toBe(id(draftParent));
      expect((await updateCategory(id(live), { parentId: id(liveParent) })).parentId?.toString()).toBe(id(liveParent));
      const both = await updateCategory(id(live), { parentId: id(draftParent), published: false });
      expect(both.parentId?.toString()).toBe(id(draftParent));
      expect(both.published).toBe(false);
      expect((await updateCategory(id(draft), { parentId: null })).parentId).toBeUndefined();
    });

    it("does not refuse an unrelated edit of data that predates the rule", async () => {
      const parent = await make();
      const child = await CategoryModel.create({ slug: "legacy-child", parentId: parent._id, published: true });
      expect((await updateCategory(id(child), { sortOrder: 3 })).sortOrder).toBe(3);
    });
  });

  describe("rule 2 — a parent with a published child can't be unpublished (no cascade)", () => {
    it("refuses, names the count, and leaves everything published", async () => {
      const parent = await make(undefined, true);
      const first = await make(parent, true);
      await make(parent, true);
      await expect(updateCategory(id(parent), { published: false })).rejects.toThrow(/2 of its sub-categories are still published/);
      expect((await stored(parent))?.published).toBe(true);
      expect((await stored(first))?.published).toBe(true);
    });

    it("uses the singular for one child", async () => {
      const parent = await make(undefined, true);
      await make(parent, true);
      await expect(updateCategory(id(parent), { published: false })).rejects.toThrow(/1 of its sub-category is still published\. Unpublish it first/);
    });

    it("allows it when every child is unpublished, and never touches the children", async () => {
      const parent = await make(undefined, true);
      const draftChild = await make(parent, false);
      expect((await updateCategory(id(parent), { published: false })).published).toBe(false);
      expect((await stored(draftChild))?.published).toBe(false);
    });

    it("allows it once the last published child has been unpublished, and for a childless category", async () => {
      const parent = await make(undefined, true);
      const child = await make(parent, true);
      await expect(updateCategory(id(parent), { published: false })).rejects.toThrow(ConflictError);
      await updateCategory(id(child), { published: false });
      expect((await updateCategory(id(parent), { published: false })).published).toBe(false);
      const lonely = await make(undefined, true);
      expect((await updateCategory(id(lonely), { published: false })).published).toBe(false);
    });
  });

  describe("rule 3 — a category with sub-categories can't be deleted", () => {
    it("says the sub-categories have to be dealt with first, and deletes nothing", async () => {
      const [parent] = await chain(2);
      await expect(deleteCategory(id(parent!))).rejects.toThrow(/1 sub-category.*Move or remove those first/);
      expect(await CategoryModel.countDocuments()).toBe(2);
    });
  });

  describe("rule 4 — nesting stops at 4 levels", () => {
    it("allows creating down to exactly level 4 and refuses level 5, storing nothing", async () => {
      const nodes = await chain(MAX_CATEGORY_DEPTH);
      expect(nodes).toHaveLength(4);
      await expect(make(nodes[3])).rejects.toThrow(/at most 4 levels deep/);
      expect(await CategoryModel.countDocuments()).toBe(4);
    });

    it("moving a leaf: level 4 is allowed, level 5 is refused", async () => {
      const nodes = await chain(MAX_CATEGORY_DEPTH);
      const leafA = await make();
      const leafB = await make();
      expect((await updateCategory(id(leafA), { parentId: id(nodes[2]!) })).parentId?.toString()).toBe(id(nodes[2]!)); // becomes level 4
      await expect(updateCategory(id(leafB), { parentId: id(nodes[3]!) })).rejects.toThrow(/at most 4 levels deep/); // would be level 5
      expect((await stored(leafB))?.parentId).toBeUndefined();
    });

    it("moving a subtree counts its height, not just the moved category", async () => {
      const nodes = await chain(MAX_CATEGORY_DEPTH - 1); // levels 1..3
      const sub = await make();
      await make(sub); // sub is a 2-level subtree
      await expect(updateCategory(id(sub), { parentId: id(nodes[2]!) })).rejects.toThrow(/\(2 levels\).*would reach level 5/); // 3 + 2
      expect((await updateCategory(id(sub), { parentId: id(nodes[1]!) })).parentId?.toString()).toBe(id(nodes[1]!)); // 2 + 2 = 4, exactly at the limit
    });

    it("moving a subtree deeper than 4 through its own descendants is refused too (3-level subtree under level 2)", async () => {
      const nodes = await chain(2);
      const [subRoot] = await chain(3);
      await expect(updateCategory(id(subRoot!), { parentId: id(nodes[1]!) })).rejects.toThrow(/would reach level 5/);
    });

    it("moves within the limit stay allowed: between siblings and up a level", async () => {
      const nodes = await chain(MAX_CATEGORY_DEPTH);
      const sibling = await make(nodes[2]!); // level 4 beside nodes[3]
      expect((await updateCategory(id(sibling), { parentId: id(nodes[1]!) })).parentId?.toString()).toBe(id(nodes[1]!));
      expect((await updateCategory(id(nodes[3]!), { parentId: id(nodes[0]!) })).parentId?.toString()).toBe(id(nodes[0]!));
    });

    it("does not refuse an unrelated edit of a category already deeper than the limit", async () => {
      const nodes = await chain(MAX_CATEGORY_DEPTH);
      const tooDeep = await CategoryModel.create({ slug: "legacy-level-5", parentId: nodes[3]!._id });
      expect((await updateCategory(id(tooDeep), { sortOrder: 1 })).sortOrder).toBe(1);
    });
  });

  describe("rule 5 — no cycles", () => {
    it("refuses a move under a deep descendant, under itself, and leaves the tree intact", async () => {
      const nodes = await chain(3);
      await expect(updateCategory(id(nodes[0]!), { parentId: id(nodes[2]!) })).rejects.toThrow(/under itself or one of its own descendants/);
      await expect(updateCategory(id(nodes[0]!), { parentId: id(nodes[0]!) })).rejects.toThrow(/its own parent/);
      expect((await stored(nodes[0]!))?.parentId).toBeUndefined();
    });
  });

  it("a missing parent is a 404 on create and on move", async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    const real = await make();
    await expect(createCategory({ name: LOCALIZED, description: LOCALIZED, slug: "orphan", parentId: ghost, seoTitle: LOCALIZED, seoDescription: LOCALIZED })).rejects.toThrow(NotFoundError);
    await expect(updateCategory(id(real), { parentId: ghost })).rejects.toThrow(NotFoundError);
  });
});
