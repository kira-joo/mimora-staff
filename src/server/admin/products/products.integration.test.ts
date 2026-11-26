import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { ProductModel } from "../../catalog/product.schema";
import { CategoryModel } from "../../catalog/category.schema";
import { listProducts } from "./list-products";
import { createProduct } from "./create-product";
import { updateProduct } from "./update-product";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { productRepository } from "../../core/repositories";
import { setProductLifecycle } from "./set-product-lifecycle";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const injectedSpies: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  while (injectedSpies.length > 0) injectedSpies.pop()!.mockRestore();
});

/**
 * Rollback-test injection. Lets the real write land, THEN fails the `nth` call
 * to `repo[method]` — so the rollback has a write that genuinely happened to
 * undo. Failing before the write would prove nothing about atomicity.
 */
function failAfterWrite(repo: object, method: string, nth = 1): void {
  const target = repo as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = target[method]!.bind(repo);
  let calls = 0;
  const spy = vi.spyOn(target, method).mockImplementation(async (...args: unknown[]) => {
    const result = await original(...args);
    calls += 1;
    if (calls === nth) throw new Error("injected failure");
    return result;
  });
  injectedSpies.push(spy);
}

describe("Admin Products", () => {
  let categoryId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await ProductModel.deleteMany({});
    await CategoryModel.deleteMany({});

    const category = await CategoryModel.create({
      name: { ar: "فئة", en: "Category" },
      slug: "test-category",
      published: true,
      sortOrder: 0,
    });
    categoryId = category._id;
  });

  describe("createProduct", () => {
    it("creates a product with required fields", async () => {
      const product = await createProduct({
        name: { ar: "منتج", en: "Product" },
        description: { ar: "وصف", en: "Description" },
        slug: "test-product",
        categoryId: categoryId.toString(),
      });

      expect(product._id).toBeDefined();
      expect(product.name.ar).toBe("منتج");
      expect(product.name.en).toBe("Product");
      expect(product.slug).toBe("test-product");
      expect(product.lifecycle).toBe("draft");
      expect(product.order).toBe(1);
    });

    it("creates a product with all optional fields", async () => {
      const product = await createProduct({
        name: { ar: "منتج", en: "Product" },
        description: { ar: "وصف", en: "Description" },
        slug: "test-product",
        categoryId: categoryId.toString(),
        collectionIds: [],
        images: [],
        optionAxes: [{ key: "size", name: { ar: "مقاس", en: "Size" } }],
        attributes: [],
        seoTitle: { ar: "عنوان", en: "Title" },
        seoDescription: { ar: "وصف", en: "Description" },
        lifecycle: "published",
      });

      expect(product.lifecycle).toBe("published");
      expect(product.order).toBe(1);
      expect(product.optionAxes).toHaveLength(1);
    });

    it("throws ConflictError on duplicate slug", async () => {
      await createProduct({
        name: { ar: "منتج", en: "Product" },
        description: { ar: "وصف", en: "Description" },
        slug: "duplicate-slug",
        categoryId: categoryId.toString(),
      });

      await expect(
        createProduct({
          name: { ar: "منتج 2", en: "Product 2" },
          description: { ar: "وصف", en: "Description" },
          slug: "duplicate-slug",
          categoryId: categoryId.toString(),
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("updateProduct", () => {
    it("updates product fields", async () => {
      const created = await createProduct({
        name: { ar: "منتج", en: "Product" },
        description: { ar: "وصف", en: "Description" },
        slug: "test-product",
        categoryId: categoryId.toString(),
      });

      const updated = await updateProduct(created._id.toString(), {
        name: { ar: "منتج محدث", en: "Updated Product" },
      });

      expect(updated.name.ar).toBe("منتج محدث");
      expect(updated.name.en).toBe("Updated Product");
      expect(updated.order).toBe(created.order);
      expect(updated.slug).toBe("test-product");
    });

    it("throws ConflictError when updating to duplicate slug", async () => {
      await createProduct({
        name: { ar: "منتج 1", en: "Product 1" },
        description: { ar: "وصف", en: "Description" },
        slug: "product-1",
        categoryId: categoryId.toString(),
      });

      const product2 = await createProduct({
        name: { ar: "منتج 2", en: "Product 2" },
        description: { ar: "وصف", en: "Description" },
        slug: "product-2",
        categoryId: categoryId.toString(),
      });

      await expect(updateProduct(product2._id.toString(), { slug: "product-1" })).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for non-existent product", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(updateProduct(fakeId, { name: { ar: "س", en: "x" } })).rejects.toThrow(NotFoundError);
    });
  });

  describe("rollback — a failure inside the transaction leaves no partial state", () => {
    async function seedProduct() {
      return createProduct({
        name: { ar: "منتج", en: "Product" },
        description: { ar: "وصف", en: "Description" },
        slug: "rollback-product",
        categoryId: categoryId.toString(),
      });
    }

    it("updateProduct: the product edit is undone when the transaction fails after the write", async () => {
      const created = await seedProduct();
      const before = await ProductModel.findById(created._id).lean();
      failAfterWrite(productRepository, "update", 1); // the only write; it lands, then throws

      await expect(
        updateProduct(created._id.toString(), { name: { ar: "جديد", en: "Renamed" }, slug: "renamed" })
      ).rejects.toThrow("injected failure");

      expect(await ProductModel.findById(created._id).lean()).toEqual(before);
    });

    it("setProductLifecycle: the lifecycle change is undone when the transaction fails after the write", async () => {
      const created = await seedProduct();
      const before = await ProductModel.findById(created._id).lean();
      failAfterWrite(productRepository, "update", 1);

      await expect(setProductLifecycle(created._id.toString(), "published")).rejects.toThrow("injected failure");

      const after = await ProductModel.findById(created._id).lean();
      expect(after?.lifecycle).toBe("draft");
      expect(after).toEqual(before);
    });
  });

  describe("listProducts", () => {
    it("lists products with pagination", async () => {
      await createProduct({
        name: { ar: "منتج 1", en: "Product 1" },
        description: { ar: "وصف", en: "Description" },
        slug: "product-1",
        categoryId: categoryId.toString(),
      });

      await createProduct({
        name: { ar: "منتج 2", en: "Product 2" },
        description: { ar: "وصف", en: "Description" },
        slug: "product-2",
        categoryId: categoryId.toString(),
      });

      const result = await listProducts({ limit: 10, page: 1 });

      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it("filters products by lifecycle", async () => {
      await createProduct({
        name: { ar: "منتج 1", en: "Product 1" },
        description: { ar: "وصف", en: "Description" },
        slug: "product-1",
        categoryId: categoryId.toString(),
        lifecycle: "draft",
      });

      await createProduct({
        name: { ar: "منتج 2", en: "Product 2" },
        description: { ar: "وصف", en: "Description" },
        slug: "product-2",
        categoryId: categoryId.toString(),
        lifecycle: "published",
      });

      const result = await listProducts({ limit: 10, page: 1, lifecycle: "published" });

      expect(result.total).toBe(1);
      expect(result.data[0].slug).toBe("product-2");
    });

    it("filters products by categoryId", async () => {
      const category2 = await CategoryModel.create({
        name: { ar: "فئة 2", en: "Category 2" },
        slug: "category-2",
        published: true,
        sortOrder: 0,
      });

      await createProduct({
        name: { ar: "منتج 1", en: "Product 1" },
        description: { ar: "وصف", en: "Description" },
        slug: "product-1",
        categoryId: categoryId.toString(),
      });

      await createProduct({
        name: { ar: "منتج 2", en: "Product 2" },
        description: { ar: "وصف", en: "Description" },
        slug: "product-2",
        categoryId: category2._id.toString(),
      });

      const result = await listProducts({ limit: 10, page: 1, categoryId: categoryId.toString() });

      expect(result.total).toBe(1);
      expect(result.data[0].slug).toBe("product-1");
    });

    it("a new product is appended: order is one past the highest, and the default list is the manual order", async () => {
      const p1 = await createProduct({ name: { ar: "منتج 1", en: "Product 1" }, description: { ar: "وصف", en: "Description" }, slug: "product-1", categoryId: categoryId.toString() });
      await ProductModel.updateOne({ _id: p1._id }, { $set: { order: 7 } });
      const p2 = await createProduct({ name: { ar: "منتج 2", en: "Product 2" }, description: { ar: "وصف", en: "Description" }, slug: "product-2", categoryId: categoryId.toString() });
      const p3 = await createProduct({ name: { ar: "منتج 3", en: "Product 3" }, description: { ar: "وصف", en: "Description" }, slug: "product-3", categoryId: categoryId.toString(), lifecycle: "archived" });

      expect([p1.order, p2.order, p3.order]).toEqual([1, 8, 9]);
      const manual = await listProducts({ limit: 10, page: 1 });
      expect(manual.data.map((p) => p._id)).toEqual([p1, p2, p3].map((p) => p._id.toString()));
    });

    it("price sorts order by the lowest active price (unpriced last), and search + filters still apply", async () => {
      const make = async (slug: string, price: string | undefined) => {
        const created = await createProduct({ name: { ar: slug, en: `Ring ${slug}` }, description: { ar: "وصف", en: "Description" }, slug, categoryId: categoryId.toString() });
        if (price) await ProductModel.updateOne({ _id: created._id }, { $set: { "listing.minActivePrice": Number(price), "listing.maxActivePrice": Number(price) } });
        return created._id.toString();
      };
      const [dear, cheap, none] = [await make("dear", "50"), await make("cheap", "9.5"), await make("none", undefined)];

      const ids = async (query: Partial<Parameters<typeof listProducts>[0]>) => (await listProducts({ limit: 10, page: 1, ...query })).data.map((p) => p._id);
      expect(await ids({ sort: "price_asc" })).toEqual([cheap, dear, none]);
      expect(await ids({ sort: "price_desc" })).toEqual([dear, cheap, none]);
      expect(await ids({ sort: "price_asc", search: "dear" })).toEqual([dear]);
      expect(await ids({ sort: "price_asc", lifecycle: "published" })).toEqual([]);
      const paged = await listProducts({ limit: 2, page: 2, sort: "price_asc" });
      expect([paged.total, paged.totalPages, paged.data.map((p) => p._id)]).toEqual([3, 2, [none]]);
    });

    it("sort=manual ties newest first; newest/oldest sort by createdAt", async () => {
      const make = async (slug: string) => {
        const created = await createProduct({ name: { ar: slug, en: slug }, description: { ar: "وصف", en: "Description" }, slug, categoryId: categoryId.toString() });
        await new Promise((resolve) => setTimeout(resolve, 10));
        return created._id.toString();
      };
      const [a, b, c] = [await make("a"), await make("b"), await make("c")];
      await ProductModel.updateMany({}, { $set: { order: 0 } });

      const ids = async (sort?: "manual" | "newest" | "oldest") => (await listProducts({ limit: 10, page: 1, sort })).data.map((p) => p._id);
      expect(await ids()).toEqual([c, b, a]);
      expect(await ids("manual")).toEqual([c, b, a]);
      expect(await ids("newest")).toEqual([c, b, a]);
      expect(await ids("oldest")).toEqual([a, b, c]);
    });
  });
});
