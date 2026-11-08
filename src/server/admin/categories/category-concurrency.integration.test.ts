import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ServiceUnavailableError } from "@kira-joo/backend-toolkit-core";
import { getActiveTransaction, withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { PromotionModel } from "../../commerce/promotion.schema";
import { StorefrontContentModel } from "../../content/storefront-content.schema";
import { productRepository } from "../../core/repositories";
import { createProduct } from "../products/create-product";
import { updateProduct } from "../products/update-product";
import { createCategory } from "./create-category";
import { updateCategory } from "./update-category";
import { deleteCategory } from "./delete-category";
import { lockCategoryForAssignment, touchCategory } from "./category-hierarchy";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "نص", en: "Text" };
let counter = 0;
const make = (parentId?: string) => createCategory({ name: LOCALIZED, description: LOCALIZED, slug: `k-${(counter += 1)}`, parentId, seoTitle: LOCALIZED, seoDescription: LOCALIZED });
const product = (categoryId: string) => createProduct({ name: LOCALIZED, description: LOCALIZED, slug: `p-${(counter += 1)}`, categoryId });
const id = (category: { _id: mongoose.Types.ObjectId }) => category._id.toString();

const holders: Array<{ release: () => void; done: Promise<void> }> = [];

/** A transaction held open on purpose: runs `work`, signals it is in flight, then waits for `release()` before committing. */
function holdTransaction(work: () => Promise<void>) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let inFlight!: () => void;
  const ready = new Promise<void>((resolve) => (inFlight = resolve));
  const done = withTransaction(async (tx) => {
    await work();
    inFlight();
    await gate;
    return tx.complete(undefined);
  });
  const held = { ready, release, done };
  holders.push(held);
  return held;
}

/** Every category's parent chain ends at a root — no loop anywhere. */
async function assertNoCycles() {
  const all = await CategoryModel.find().lean();
  const parentOf = new Map(all.map((category) => [category._id.toString(), category.parentId?.toString()]));
  for (const start of parentOf.keys()) {
    const seen = new Set<string>();
    for (let current: string | undefined = start; current; current = parentOf.get(current)) {
      expect(seen.has(current), `cycle through ${current}`).toBe(false);
      seen.add(current);
    }
  }
}

/** The invariant the whole design exists for: no product names a category that does not exist. */
async function danglingProducts() {
  const [products, categories] = await Promise.all([ProductModel.collection.find({}).toArray(), CategoryModel.find({}, { _id: 1 }).lean()]);
  const known = new Set(categories.map((category) => category._id.toString()));
  return products.filter((row) => !known.has(String(row.categoryId)));
}

describe("category concurrency", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });
  afterAll(async () => {
    await mongoose.disconnect();
  });
  afterEach(async () => {
    // A failed assertion must not leave a transaction open: it would hold its locks against every test after it.
    for (const held of holders.splice(0)) {
      held.release();
      await held.done.catch(() => undefined);
    }
  });
  beforeEach(async () => {
    await Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({}), PromotionModel.collection.deleteMany({}), StorefrontContentModel.collection.deleteMany({})]);
  });

  describe("delete vs. product assignment (rule 6)", () => {
    it("a product being assigned in an open transaction blocks the delete; once it commits, the delete is refused for it", async () => {
      const category = await make();
      const assigning = holdTransaction(async () => {
        await lockCategoryForAssignment(id(category));
        await productRepository.save({ name: LOCALIZED, description: LOCALIZED, slug: "held", categoryId: id(category) as never, lifecycle: "draft" });
      });
      await assigning.ready;

      // Without the write-conflict this delete would see no product (the other transaction is uncommitted) and succeed,
      // and the product would then commit pointing at a deleted category.
      await expect(deleteCategory(id(category))).rejects.toThrow(ServiceUnavailableError);
      expect(await CategoryModel.countDocuments({ _id: category._id })).toBe(1);

      assigning.release();
      await assigning.done;
      await expect(deleteCategory(id(category))).rejects.toThrow(/1 product is assigned to it/);
      expect(await danglingProducts()).toEqual([]);
      expect(await CategoryModel.countDocuments({ _id: category._id })).toBe(1);
    });

    it("a delete in flight blocks a product create; once it commits, the create is refused with 404 and no product exists", async () => {
      const category = await make();
      const deleting = holdTransaction(async () => {
        await touchCategory(id(category)); // exactly what deleteCategory does first
        await CategoryModel.deleteOne({ _id: category._id }, { session: getActiveTransaction()!.session });
      });
      await deleting.ready;

      await expect(product(id(category))).rejects.toThrow(ServiceUnavailableError);
      expect(await ProductModel.countDocuments()).toBe(0);

      deleting.release();
      await deleting.done;
      await expect(product(id(category))).rejects.toThrow(NotFoundError);
      expect(await ProductModel.countDocuments()).toBe(0);
      expect(await danglingProducts()).toEqual([]);
    });

    it("a delete in flight blocks moving an existing product into the category", async () => {
      const [source, target] = [await make(), await make()];
      const existing = await product(id(source));
      const deleting = holdTransaction(async () => {
        await touchCategory(id(target));
      });
      await deleting.ready;
      await expect(updateProduct(id(existing), { categoryId: id(target) })).rejects.toThrow(ServiceUnavailableError);
      deleting.release();
      await deleting.done;
      expect((await ProductModel.findById(existing._id).lean())?.categoryId.toString()).toBe(id(source));
    });

    it("refuses a product create or move into a category that does not exist", async () => {
      const real = await make();
      const ghost = new mongoose.Types.ObjectId().toString();
      await expect(product(ghost)).rejects.toThrow(/Category not found/);
      const existing = await product(id(real));
      await expect(updateProduct(id(existing), { categoryId: ghost })).rejects.toThrow(NotFoundError);
      expect((await ProductModel.findById(existing._id).lean())?.categoryId.toString()).toBe(id(real));
    });

    it("assigning a product does not rewrite the category's updatedAt", async () => {
      const category = await make();
      const updatedAt = async () => ((await CategoryModel.findById(category._id).lean()) as unknown as { updatedAt: Date }).updatedAt;
      const before = await updatedAt();
      await product(id(category));
      expect(await updatedAt()).toEqual(before);
    });

    it("racing deletes against product creates never leaves a dangling product (30 real races)", async () => {
      const outcomes = { deleted: 0, assigned: 0 };
      for (let round = 0; round < 30; round += 1) {
        const category = await make();
        const [deletion, creation] = await Promise.allSettled([deleteCategory(id(category)), product(id(category))]);
        expect(await danglingProducts()).toEqual([]);
        // They can both lose (503 on repeated conflicts) but never both win.
        expect(deletion.status === "fulfilled" && creation.status === "fulfilled").toBe(false);
        if (deletion.status === "fulfilled") outcomes.deleted += 1;
        if (creation.status === "fulfilled") outcomes.assigned += 1;
        await Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({})]);
      }
      expect(outcomes.deleted + outcomes.assigned).toBeGreaterThan(0);
    });
  });

  describe("cycle check vs. concurrent moves (rule 7)", () => {
    it("A under B while B under A: never both succeed, never a cycle (20 real races)", async () => {
      for (let round = 0; round < 20; round += 1) {
        const [a, b] = [await make(), await make()];
        const results = await Promise.allSettled([updateCategory(id(a), { parentId: id(b) }), updateCategory(id(b), { parentId: id(a) })]);
        expect(results.filter((result) => result.status === "fulfilled").length).toBeLessThanOrEqual(1);
        await assertNoCycles();
        await CategoryModel.deleteMany({});
      }
    });

    it("two moves that share no moved or parent document still can't close a loop: a→d and c→b, then a under b while c under d", async () => {
      for (let round = 0; round < 20; round += 1) {
        const a = await make();
        const d = await make(id(a));
        const c = await make();
        const b = await make(id(c));
        const results = await Promise.allSettled([updateCategory(id(a), { parentId: id(b) }), updateCategory(id(c), { parentId: id(d) })]);
        expect(results.filter((result) => result.status === "fulfilled").length).toBeLessThanOrEqual(1);
        await assertNoCycles();
        await CategoryModel.deleteMany({});
      }
    });

    it("a move in flight blocks a move whose parent chain it has written, and is then refused by the cycle check", async () => {
      const [a, b] = [await make(), await make()];
      const moving = holdTransaction(async () => {
        await updateCategory(id(a), { parentId: id(b) }); // joins this transaction: A is written, B's chain touched
      });
      await moving.ready;
      await expect(updateCategory(id(b), { parentId: id(a) })).rejects.toThrow(ServiceUnavailableError);
      moving.release();
      await moving.done;
      await expect(updateCategory(id(b), { parentId: id(a) })).rejects.toThrow(/under itself or one of its own descendants/);
      await assertNoCycles();
    });

    it("publishing a child races unpublishing its parent: the parent can never end unpublished with a published child (20 real races)", async () => {
      for (let round = 0; round < 20; round += 1) {
        const parent = await createCategory({ name: LOCALIZED, description: LOCALIZED, slug: `r-${(counter += 1)}`, published: true, seoTitle: LOCALIZED, seoDescription: LOCALIZED });
        const child = await make(id(parent));
        await Promise.allSettled([updateCategory(id(child), { published: true }), updateCategory(id(parent), { published: false })]);
        const [p, c] = [await CategoryModel.findById(parent._id).lean(), await CategoryModel.findById(child._id).lean()];
        expect(c!.published && !p!.published, "published child under unpublished parent").toBe(false);
        await CategoryModel.deleteMany({});
      }
    });
  });
});
