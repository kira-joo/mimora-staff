import { Decimal } from "decimal.js";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { submitReview } from "./submit-review";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { OrderModel, OrderLineModel } from "../../commerce/order.schema";
import { ReviewModel } from "../../content/review.schema";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { CustomerIdentity } from "../../core/auth/resolve-customer";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

function customerIdentity(): CustomerIdentity {
  return { _id: new mongoose.Types.ObjectId().toString(), name: "Test Customer", phone: "+201000000000" };
}

async function createProduct(sku: string) {
  return ProductModel.create({
    slug: `product-${sku.toLowerCase()}`,
    categoryId: new mongoose.Types.ObjectId(),
    name: { en: "Test Product", ar: "منتج تجريبي" },
    lifecycle: "published",
  });
}

async function createVariant(productId: mongoose.Types.ObjectId, sku: string) {
  return VariantModel.create({
    productId,
    sku,
    variantKey: `key-${sku}`,
    stock: 10,
    price: new Decimal("50.00"),
    backorderPolicy: "DENY",
  });
}

async function createOrderWithLine(customerId: string, status: "DELIVERED" | "COLLECTED" | "IN_TRANSIT" | "PLACED", variantId: mongoose.Types.ObjectId) {
  const order = await OrderModel.create({
    orderNumber: `ORD-${new mongoose.Types.ObjectId().toString().toUpperCase()}`,
    idempotencyKey: `test-key-${new mongoose.Types.ObjectId().toString()}`,
    customerId,
    status,
    placedAt: new Date(),
    subtotal: new Decimal("50.00"),
    total: new Decimal("50.00"),
    fulfilment: { mode: "PICKUP", fee: new Decimal("0"), pickupLocationSnapshot: { name: "Store", address: "123", phone: "555" } },
    payment: { method: "COD", status: "NOT_REQUIRED" },
  });
  await OrderLineModel.create({
    orderId: order._id,
    lineNumber: 1,
    variantId,
    sku: "SKU",
    productName: "Product",
    variantDescription: "Default",
    quantity: 1,
    unitPrice: new Decimal("50.00"),
    lineTotal: new Decimal("50.00"),
  });
  return order;
}

describe("submitReview", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await ProductModel.deleteMany({});
    await VariantModel.deleteMany({});
    await OrderModel.deleteMany({});
    await OrderLineModel.deleteMany({});
    await ReviewModel.deleteMany({});
  });

  it("creates a new review as PENDING with verifiedPurchase true", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-1");
    const variant = await createVariant(product._id, "SKU-1");
    await createOrderWithLine(customer._id, "DELIVERED", variant._id);

    const result = await submitReview({
      customer,
      productId: product._id.toString(),
      rating: 5,
      title: "Great product",
      body: "Loved it",
      locale: "en",
    });

    expect(result.status).toBe("PENDING");
    expect(result.verifiedPurchase).toBe(true);
    expect(result.rating).toBe(5);
    expect(result.title).toEqual({ en: "Great product", ar: "" });
    expect(result.body).toEqual({ en: "Loved it", ar: "" });

    expect(await ReviewModel.countDocuments({ productId: product._id, customerId: customer._id })).toBe(1);
  });

  it("edits an existing review via upsert rather than creating a second one", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-2");
    const variant = await createVariant(product._id, "SKU-2");
    await createOrderWithLine(customer._id, "DELIVERED", variant._id);

    const first = await submitReview({ customer, productId: product._id.toString(), rating: 3, title: "OK", body: "Fine", locale: "en" });
    const second = await submitReview({ customer, productId: product._id.toString(), rating: 5, title: "Actually great", body: "Changed my mind", locale: "en" });

    expect(second.reviewId).toBe(first.reviewId);
    expect(second.rating).toBe(5);
    expect(second.title).toEqual({ en: "Actually great", ar: "" });
    expect(await ReviewModel.countDocuments({ productId: product._id, customerId: customer._id })).toBe(1);
  });

  it("a COLLECTED pickup order qualifies a customer to review; one still IN_TRANSIT does not", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-C");
    const variant = await createVariant(product._id, "SKU-C");
    await createOrderWithLine(customer._id, "IN_TRANSIT", variant._id);
    await expect(submitReview({ customer, productId: product._id.toString(), rating: 5, title: "t", body: "b", locale: "en" })).rejects.toThrow();

    await createOrderWithLine(customer._id, "COLLECTED", variant._id);
    const result = await submitReview({ customer, productId: product._id.toString(), rating: 5, title: "t", body: "b", locale: "en" });
    expect(result.verifiedPurchase).toBe(true);
  });

  it("editing an APPROVED review resets it to PENDING and clears moderation metadata", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-3");
    const variant = await createVariant(product._id, "SKU-3");
    await createOrderWithLine(customer._id, "DELIVERED", variant._id);

    const created = await submitReview({ customer, productId: product._id.toString(), rating: 4, title: "Good", body: "Good", locale: "en" });
    await ReviewModel.updateOne(
      { _id: created.reviewId },
      { $set: { status: "APPROVED", moderatedBy: new mongoose.Types.ObjectId(), moderatedAt: new Date() } }
    );

    const edited = await submitReview({ customer, productId: product._id.toString(), rating: 4, title: "Still good", body: "Updated", locale: "en" });

    expect(edited.status).toBe("PENDING");
    const raw = await ReviewModel.findById(edited.reviewId).lean();
    expect(raw?.moderatedBy).toBeUndefined();
    expect(raw?.moderatedAt).toBeUndefined();
  });

  it("editing a PENDING review remains PENDING", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-4");
    const variant = await createVariant(product._id, "SKU-4");
    await createOrderWithLine(customer._id, "DELIVERED", variant._id);

    await submitReview({ customer, productId: product._id.toString(), rating: 4, title: "Good", body: "Good", locale: "en" });
    const edited = await submitReview({ customer, productId: product._id.toString(), rating: 4, title: "Still good", body: "Updated", locale: "en" });

    expect(edited.status).toBe("PENDING");
  });

  it("editing a REJECTED review follows the same create-or-edit contract, resetting to PENDING", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-5");
    const variant = await createVariant(product._id, "SKU-5");
    await createOrderWithLine(customer._id, "DELIVERED", variant._id);

    const created = await submitReview({ customer, productId: product._id.toString(), rating: 2, title: "Bad", body: "Bad", locale: "en" });
    await ReviewModel.updateOne(
      { _id: created.reviewId },
      { $set: { status: "REJECTED", moderatedBy: new mongoose.Types.ObjectId(), moderatedAt: new Date() } }
    );

    const edited = await submitReview({ customer, productId: product._id.toString(), rating: 4, title: "Reconsidered", body: "Better now", locale: "en" });

    expect(edited.status).toBe("PENDING");
  });

  it("throws NotFoundError for a nonexistent product", async () => {
    const customer = customerIdentity();

    await expect(
      submitReview({ customer, productId: new mongoose.Types.ObjectId().toString(), rating: 5, title: "x", body: "x", locale: "en" })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when the customer never purchased the product", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-6");

    await expect(
      submitReview({ customer, productId: product._id.toString(), rating: 5, title: "x", body: "x", locale: "en" })
    ).rejects.toThrow(ConflictError);
  });

  it("throws ConflictError when the order exists but is not DELIVERED", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-7");
    const variant = await createVariant(product._id, "SKU-7");
    await createOrderWithLine(customer._id, "PLACED", variant._id);

    await expect(
      submitReview({ customer, productId: product._id.toString(), rating: 5, title: "x", body: "x", locale: "en" })
    ).rejects.toThrow(ConflictError);
  });

  it("does not become eligible merely because another customer purchased the product", async () => {
    const customer = customerIdentity();
    const otherCustomer = customerIdentity();
    const product = await createProduct("SKU-8");
    const variant = await createVariant(product._id, "SKU-8");
    await createOrderWithLine(otherCustomer._id, "DELIVERED", variant._id);

    await expect(
      submitReview({ customer, productId: product._id.toString(), rating: 5, title: "x", body: "x", locale: "en" })
    ).rejects.toThrow(ConflictError);
  });

  it("is eligible when the product was purchased through a different variant of the same product", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-9");
    const variantA = await createVariant(product._id, "SKU-9-A");
    await createVariant(product._id, "SKU-9-B"); // never purchased
    await createOrderWithLine(customer._id, "DELIVERED", variantA._id);

    const result = await submitReview({ customer, productId: product._id.toString(), rating: 5, title: "x", body: "x", locale: "en" });

    expect(result.status).toBe("PENDING");
  });

  it("does not create two reviews when the same customer/product submission runs concurrently", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-10");
    const variant = await createVariant(product._id, "SKU-10");
    await createOrderWithLine(customer._id, "DELIVERED", variant._id);

    await Promise.all([
      submitReview({ customer, productId: product._id.toString(), rating: 4, title: "A", body: "A", locale: "en" }),
      submitReview({ customer, productId: product._id.toString(), rating: 5, title: "B", body: "B", locale: "en" }),
    ]);

    expect(await ReviewModel.countDocuments({ productId: product._id, customerId: customer._id })).toBe(1);
  });

  it("allows the same customer to review different products independently", async () => {
    const customer = customerIdentity();
    const productA = await createProduct("SKU-11A");
    const productB = await createProduct("SKU-11B");
    const variantA = await createVariant(productA._id, "SKU-11A");
    const variantB = await createVariant(productB._id, "SKU-11B");
    await createOrderWithLine(customer._id, "DELIVERED", variantA._id);
    await createOrderWithLine(customer._id, "DELIVERED", variantB._id);

    await submitReview({ customer, productId: productA._id.toString(), rating: 5, title: "A", body: "A", locale: "en" });
    await submitReview({ customer, productId: productB._id.toString(), rating: 3, title: "B", body: "B", locale: "en" });

    expect(await ReviewModel.countDocuments({ customerId: customer._id })).toBe(2);
  });

  it("allows different customers to review the same product independently", async () => {
    const customer1 = customerIdentity();
    const customer2 = customerIdentity();
    const product = await createProduct("SKU-12");
    const variant = await createVariant(product._id, "SKU-12");
    await createOrderWithLine(customer1._id, "DELIVERED", variant._id);
    await createOrderWithLine(customer2._id, "DELIVERED", variant._id);

    await submitReview({ customer: customer1, productId: product._id.toString(), rating: 5, title: "A", body: "A", locale: "en" });
    await submitReview({ customer: customer2, productId: product._id.toString(), rating: 2, title: "B", body: "B", locale: "en" });

    expect(await ReviewModel.countDocuments({ productId: product._id })).toBe(2);
  });

  it("stores the submitted text under the resolved Arabic locale, leaving English blank", async () => {
    const customer = customerIdentity();
    const product = await createProduct("SKU-13");
    const variant = await createVariant(product._id, "SKU-13");
    await createOrderWithLine(customer._id, "DELIVERED", variant._id);

    const result = await submitReview({ customer, productId: product._id.toString(), rating: 5, title: "رائع", body: "منتج ممتاز", locale: "ar" });

    expect(result.title).toEqual({ ar: "رائع", en: "" });
    expect(result.body).toEqual({ ar: "منتج ممتاز", en: "" });
  });
});
