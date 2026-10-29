import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { WishlistModel } from "../../commerce/wishlist.schema";
import { CustomerModel } from "../../identity/customer.schema";
import { ProductModel } from "../../catalog/product.schema";
import { addToWishlist } from "./add-to-wishlist";
import { NotFoundError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

describe("addToWishlist", () => {
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

  it("adds a product to the wishlist", async () => {
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

    const result = await addToWishlist(customer._id.toString(), product._id.toString());

    expect(result.alreadyExisted).toBe(false);
    expect(result.productId).toBe(product._id.toString());
    expect(result.addedAt).toBeInstanceOf(Date);

    const items = await WishlistModel.find({ customerId: customer._id }).lean();
    expect(items).toHaveLength(1);
    expect(items[0].productId.toString()).toBe(product._id.toString());
    expect(items[0].customerProductKey).toBe(`${customer._id}|${product._id}`);
  });

  it("returns alreadyExisted true when product is already in wishlist", async () => {
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

    const firstAdd = await addToWishlist(customer._id.toString(), product._id.toString());
    expect(firstAdd.alreadyExisted).toBe(false);

    const secondAdd = await addToWishlist(customer._id.toString(), product._id.toString());
    expect(secondAdd.alreadyExisted).toBe(true);
    expect(secondAdd._id).toBe(firstAdd._id);
    expect(secondAdd.productId).toBe(product._id.toString());

    const items = await WishlistModel.find({ customerId: customer._id }).lean();
    expect(items).toHaveLength(1);
  });

  it("handles duplicate key error gracefully during concurrent adds", async () => {
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

    // Add once
    await addToWishlist(customer._id.toString(), product._id.toString());

    // Try to add again - should handle gracefully
    const result = await addToWishlist(customer._id.toString(), product._id.toString());

    expect(result.alreadyExisted).toBe(true);
    expect(result.productId).toBe(product._id.toString());

    const items = await WishlistModel.find({ customerId: customer._id }).lean();
    expect(items).toHaveLength(1);
  });

  it("throws NotFoundError when product does not exist", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000004",
      passwordHash: "hash",
      name: "Customer",
    });

    const nonExistentProductId = new mongoose.Types.ObjectId().toString();

    await expect(
      addToWishlist(customer._id.toString(), nonExistentProductId)
    ).rejects.toThrow(NotFoundError);

    const items = await WishlistModel.find({ customerId: customer._id }).lean();
    expect(items).toHaveLength(0);
  });

  it("throws NotFoundError when product is not published", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000005",
      passwordHash: "hash",
      name: "Customer",
    });

    const draftProduct = await ProductModel.create({
      slug: "draft-product",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Draft Product", ar: "منتج مسودة" },
      lifecycle: "draft",
    });

    await expect(
      addToWishlist(customer._id.toString(), draftProduct._id.toString())
    ).rejects.toThrow(NotFoundError);

    const items = await WishlistModel.find({ customerId: customer._id }).lean();
    expect(items).toHaveLength(0);
  });

  it("allows different customers to add the same product", async () => {
    const customer1 = await CustomerModel.create({
      phone: "+201000000006",
      passwordHash: "hash",
      name: "Customer 1",
    });

    const customer2 = await CustomerModel.create({
      phone: "+201000000007",
      passwordHash: "hash",
      name: "Customer 2",
    });

    const product = await ProductModel.create({
      slug: "shared-product",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Shared Product", ar: "منتج مشترك" },
      lifecycle: "published",
    });

    const result1 = await addToWishlist(customer1._id.toString(), product._id.toString());
    const result2 = await addToWishlist(customer2._id.toString(), product._id.toString());

    expect(result1.alreadyExisted).toBe(false);
    expect(result2.alreadyExisted).toBe(false);
    expect(result1._id).not.toBe(result2._id);

    const items1 = await WishlistModel.find({ customerId: customer1._id }).lean();
    const items2 = await WishlistModel.find({ customerId: customer2._id }).lean();

    expect(items1).toHaveLength(1);
    expect(items2).toHaveLength(1);
  });

  it("preserves original addedAt date when product already exists", async () => {
    const customer = await CustomerModel.create({
      phone: "+201000000008",
      passwordHash: "hash",
      name: "Customer",
    });

    const product = await ProductModel.create({
      slug: "test-product",
      categoryId: new mongoose.Types.ObjectId(),
      name: { en: "Test Product", ar: "منتج تجريبي" },
      lifecycle: "published",
    });

    const firstAdd = await addToWishlist(customer._id.toString(), product._id.toString());
    const originalDate = firstAdd.addedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondAdd = await addToWishlist(customer._id.toString(), product._id.toString());

    expect(secondAdd.addedAt).toEqual(originalDate);
  });
});
