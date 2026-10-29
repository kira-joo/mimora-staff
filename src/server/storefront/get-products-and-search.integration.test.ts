// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CategoryModel } from "../catalog/category.schema";
import { ProductModel } from "../catalog/product.schema";
import { connectToDatabase } from "../core/db/connect";
import { StorefrontSearchQueryDto } from "../catalog/dto/storefront-search-query.dto";
import { ListStorefrontProductsQueryDto } from "../catalog/dto/list-storefront-products-query.dto";
import { getProducts } from "./get-products";
import { searchProducts } from "./search-products";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([CategoryModel.deleteMany({}), ProductModel.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

/**
 * `getProducts`/`searchProducts` are thin delegates to `mongoCatalogSearchPort`,
 * whose own filter/facet correctness is already covered in depth by
 * `mongo-catalog-search-port.integration.test.ts`. These tests exist to
 * prove the WIRING — the storefront-facing DTO/function correctly reaches
 * that already-tested port — not to re-verify its internal logic.
 */
describe("getProducts — wiring to CatalogSearchPort", () => {
  it("only returns published products, and honours the categoryId filter end to end", async () => {
    const category = await CategoryModel.create({ slug: "shoes" });
    const otherCategory = await CategoryModel.create({ slug: "hats" });
    await ProductModel.create({ slug: "sneaker", categoryId: category._id, lifecycle: "published", name: { en: "Sneaker", ar: "حذاء رياضي" }, listing: { purchasableVariantCount: 1 } });
    await ProductModel.create({ slug: "cap", categoryId: otherCategory._id, lifecycle: "published", name: { en: "Cap", ar: "قبعة" }, listing: { purchasableVariantCount: 1 } });
    await ProductModel.create({ slug: "draft-shoe", categoryId: category._id, lifecycle: "draft", name: { en: "Draft", ar: "مسودة" } });

    const query = new ListStorefrontProductsQueryDto();
    query.categoryId = category._id.toString();

    const result = await getProducts(query);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.slug).toBe("sneaker");
  });
});

function searchQuery(q: string, extra: Partial<StorefrontSearchQueryDto> = {}) {
  return Object.assign(new StorefrontSearchQueryDto(), { q }, extra);
}

describe("searchProducts — wiring to CatalogSearchPort", () => {
  it("finds a product by its localized name", async () => {
    const category = await CategoryModel.create({ slug: "c" });
    await ProductModel.create({ slug: "red-shirt", categoryId: category._id, lifecycle: "published", name: { en: "Red Shirt", ar: "قميص أحمر" } });

    const result = await searchProducts(searchQuery("Red Shirt"));
    expect(result.data).toHaveLength(1);
  });

  it("finds nothing for an unrelated term", async () => {
    const category = await CategoryModel.create({ slug: "c" });
    await ProductModel.create({ slug: "red-shirt", categoryId: category._id, lifecycle: "published", name: { en: "Red Shirt", ar: "قميص أحمر" } });

    const result = await searchProducts(searchQuery("nonexistent-term-xyz"));
    expect(result.data).toHaveLength(0);
  });
});
