import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { WishlistModel } from "../../commerce/wishlist.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { ProductModel } from "../../catalog/product.schema";
import { removeFromWishlist } from "./remove-from-wishlist";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("removeFromWishlist", () => {
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

  it("removes a product from the wishlist", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000001",
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

    await removeFromWishlist(customer._id.toString(), product._id.toString());

    const items = await WishlistModel.find({ customerId: customer._id }).lean();
    expect(items).toHaveLength(0);
  });

  it("is idempotent when product is not in wishlist", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000002",
      passwordHash: "hash",
      name: "Customer",
    });

    const product = await ProductModel.create({
      slug: "test-product",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Test Product", ar: "منتج تجريبي" },
      lifecycle: "published",
    });

    // Remove a product that's not in the wishlist - should not throw
    await removeFromWishlist(customer._id.toString(), product._id.toString());

    const items = await WishlistModel.find({ customerId: customer._id }).lean();
    expect(items).toHaveLength(0);
  });

  it("is idempotent when called multiple times", async () => {
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

    // Remove once
    await removeFromWishlist(customer._id.toString(), product._id.toString());
    expect(await WishlistModel.countDocuments({ customerId: customer._id })).toBe(0);

    // Remove again - should not throw
    await removeFromWishlist(customer._id.toString(), product._id.toString());
    expect(await WishlistModel.countDocuments({ customerId: customer._id })).toBe(0);
  });

  it("only removes the item for the specific customer", async () => {
    const customer1 = await CustomerModel.create({
      phone: "+201000000004",
      passwordHash: "hash",
      name: "Customer 1",
    });

    const customer2 = await CustomerModel.create({
      phone: "+201000000005",
      passwordHash: "hash",
      name: "Customer 2",
    });

    const product = await ProductModel.create({
      slug: "shared-product",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Shared Product", ar: "منتج مشترك" },
      lifecycle: "published",
    });

    await WishlistModel.create({
      customerId: customer1._id,
      productId: product._id,
      customerProductKey: `${customer1._id}|${product._id}`,
    });

    await WishlistModel.create({
      customerId: customer2._id,
      productId: product._id,
      customerProductKey: `${customer2._id}|${product._id}`,
    });

    // Remove for customer1
    await removeFromWishlist(customer1._id.toString(), product._id.toString());

    const items1 = await WishlistModel.find({ customerId: customer1._id }).lean();
    const items2 = await WishlistModel.find({ customerId: customer2._id }).lean();

    expect(items1).toHaveLength(0);
    expect(items2).toHaveLength(1);
    expect(items2[0].productId.toString()).toBe(product._id.toString());
  });

  it("removes only the specified product", async () => {
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

    // Remove only product1
    await removeFromWishlist(customer._id.toString(), product1._id.toString());

    const items = await WishlistModel.find({ customerId: customer._id }).lean();
    expect(items).toHaveLength(1);
    expect(items[0].productId.toString()).toBe(product2._id.toString());
  });

  it("works even if product has been deleted", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000007",
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

    // Delete the product
    await ProductModel.deleteOne({ _id: product._id });

    // Should still be able to remove from wishlist
    await removeFromWishlist(customer._id.toString(), product._id.toString());

    const items = await WishlistModel.find({ customerId: customer._id }).lean();
    expect(items).toHaveLength(0);
  });
});
