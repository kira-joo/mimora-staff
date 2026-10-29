import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { WishlistModel } from "../../commerce/wishlist.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { ProductModel } from "../../catalog/product.schema";
import { listWishlist } from "./list-wishlist";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("listWishlist", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await WishlistModel.deleteMany({});
    await CustomerModel.deleteMany({});
    await ProductModel.deleteMany({});
  });

  it("returns only the customer's wishlist items", async () => {
    const customer1 = await CustomerModel.create({
      phone: "+201000000001",
      passwordHash: "hash",
      name: "Customer 1",
    });

    const customer2 = await CustomerModel.create({
      phone: "+201000000002",
      passwordHash: "hash",
      name: "Customer 2",
    });

    const product1 = await ProductModel.create({
      slug: "product-1",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Product 1", ar: "منتج 1" },
      lifecycle: "published",
    });

    const product2 = await ProductModel.create({
      slug: "product-2",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Product 2", ar: "منتج 2" },
      lifecycle: "published",
    });

    await WishlistModel.create({
      customerId: customer1._id,
      productId: product1._id,
      customerProductKey: `${customer1._id}|${product1._id}`,
    });

    await WishlistModel.create({
      customerId: customer2._id,
      productId: product2._id,
      customerProductKey: `${customer2._id}|${product2._id}`,
    });

    const result = await listWishlist(customer1._id.toString(), { limit: 50, skip: 0 });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].productSlug).toBe("product-1");
  });

  it("includes product details in each item", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000003",
      passwordHash: "hash",
      name: "Customer",
    });

    const product = await ProductModel.create({
      slug: "test-product",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Test Product", ar: "منتج تجريبي" },
      lifecycle: "published",
    });

    await WishlistModel.create({
      customerId: customer._id,
      productId: product._id,
      customerProductKey: `${customer._id}|${product._id}`,
    });

    const result = await listWishlist(customer._id.toString(), { limit: 50, skip: 0 });

    expect(result.items[0]).toMatchObject({
      productId: product._id.toString(),
      productSlug: "test-product",
      productName: { en: "Test Product", ar: "منتج تجريبي" },
    });
    expect(result.items[0].addedAt).toBeInstanceOf(Date);
  });

  it("sorts by creation date descending (most recent first)", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000004",
      passwordHash: "hash",
      name: "Customer",
    });

    const product1 = await ProductModel.create({
      slug: "product-1",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Product 1", ar: "منتج 1" },
      lifecycle: "published",
    });

    const product2 = await ProductModel.create({
      slug: "product-2",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Product 2", ar: "منتج 2" },
      lifecycle: "published",
    });

    const item1 = await WishlistModel.create({
      customerId: customer._id,
      productId: product1._id,
      customerProductKey: `${customer._id}|${product1._id}`,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const item2 = await WishlistModel.create({
      customerId: customer._id,
      productId: product2._id,
      customerProductKey: `${customer._id}|${product2._id}`,
    });

    const result = await listWishlist(customer._id.toString(), { limit: 50, skip: 0 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].productSlug).toBe("product-2");
    expect(result.items[1].productSlug).toBe("product-1");
  });

  it("supports pagination", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000005",
      passwordHash: "hash",
      name: "Customer",
    });

    const products = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        ProductModel.create({
          slug: `product-${i}`,
          categoryId: new mongoose.Types.ObjectId(),
          name: { en: `Product ${i}`, ar: `منتج ${i}` },
          lifecycle: "published",
        })
      )
    );

    for (const product of products) {
      await WishlistModel.create({
        customerId: customer._id,
        productId: product._id,
        customerProductKey: `${customer._id}|${product._id}`,
      });
    }

    const page1 = await listWishlist(customer._id.toString(), { limit: 2, skip: 0 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = await listWishlist(customer._id.toString(), { limit: 2, skip: 2 });
    expect(page2.items).toHaveLength(2);
    expect(page2.total).toBe(5);

    const page3 = await listWishlist(customer._id.toString(), { limit: 2, skip: 4 });
    expect(page3.items).toHaveLength(1);
    expect(page3.total).toBe(5);
  });

  it("filters out items for deleted products", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000006",
      passwordHash: "hash",
      name: "Customer",
    });

    const product1 = await ProductModel.create({
      slug: "product-1",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Product 1", ar: "منتج 1" },
      lifecycle: "published",
    });

    const product2 = await ProductModel.create({
      slug: "product-2",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Product 2", ar: "منتج 2" },
      lifecycle: "published",
    });

    await WishlistModel.create({
      customerId: customer._id,
      productId: product1._id,
      customerProductKey: `${customer._id}|${product1._id}`,
    });

    await WishlistModel.create({
      customerId: customer._id,
      productId: product2._id,
      customerProductKey: `${customer._id}|${product2._id}`,
    });

    // Delete product2
    await ProductModel.deleteOne({ _id: product2._id });

    const result = await listWishlist(customer._id.toString(), { limit: 50, skip: 0 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].productSlug).toBe("product-1");
    expect(result.total).toBe(2); // Total still counts the entry
  });

  it("returns empty array when customer has no wishlist items", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000007",
      passwordHash: "hash",
      name: "Customer",
    });

    const result = await listWishlist(customer._id.toString(), { limit: 50, skip: 0 });

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});
