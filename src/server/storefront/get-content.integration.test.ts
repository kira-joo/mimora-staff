// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CustomerModel } from "../identity/customer.schema";
import { ProductModel } from "../catalog/product.schema";
import { CategoryModel } from "../catalog/category.schema";
import { SizeGuideModel } from "../catalog/size-guide.schema";
import { connectToDatabase } from "../core/db/connect";
import { PageModel } from "../content/page.schema";
import { ReviewModel, buildReviewKey } from "../content/review.schema";
import { getPage } from "./get-page";
import { getReviewsForProduct } from "./get-reviews";
import { getSizeGuide } from "./get-size-guide";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    SizeGuideModel.deleteMany({}),
    ReviewModel.deleteMany({}),
    PageModel.deleteMany({}),
    ProductModel.deleteMany({}),
    CategoryModel.deleteMany({}),
    CustomerModel.deleteMany({}),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("getSizeGuide", () => {
  it("throws NotFoundError for a missing id", async () => {
    await expect(getSizeGuide(new mongoose.Types.ObjectId().toString())).rejects.toThrow();
  });

  it("returns the localized size chart", async () => {
    const guide = await SizeGuideModel.create({
      name: { en: "Shirts", ar: "قمصان" },
      description: { en: "x", ar: "x" },
      chartData: { headers: ["Size", "Chest"], rows: [["S", "34-36"]] },
    });

    const found = await getSizeGuide(guide._id.toString());
    expect(found.name.en).toBe("Shirts");
    expect(found.chartData).toEqual({ headers: ["Size", "Chest"], rows: [["S", "34-36"]] });
  });
});

describe("getReviewsForProduct", () => {
  it("returns only APPROVED reviews for the given product", async () => {
    const category = await CategoryModel.create({ slug: "c" });
    const product = await ProductModel.create({ slug: "p", categoryId: category._id, lifecycle: "published", name: { en: "T", ar: "ت" } });
    const otherProduct = await ProductModel.create({ slug: "p2", categoryId: category._id, lifecycle: "published", name: { en: "T2", ar: "ت2" } });
    const customer = await CustomerModel.create({ phone: "+201000000000", passwordHash: "x", name: "C" });
    // A second customer for the PENDING review — one review per customer per
    // product is a DB-level unique constraint (`customerProductKey`), so the
    // same customer can't hold two reviews for `product`.
    const otherCustomer = await CustomerModel.create({ phone: "+201000000001", passwordHash: "x", name: "C2" });

    await ReviewModel.create([
      { productId: product._id, customerId: customer._id, customerProductKey: buildReviewKey(customer._id, product._id), rating: 5, title: { en: "Great", ar: "رائع" }, body: { en: "x", ar: "x" }, status: "APPROVED" },
      { productId: product._id, customerId: otherCustomer._id, customerProductKey: buildReviewKey(otherCustomer._id, product._id), rating: 1, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "PENDING" },
      { productId: otherProduct._id, customerId: customer._id, customerProductKey: buildReviewKey(customer._id, otherProduct._id), rating: 4, title: { en: "x", ar: "x" }, body: { en: "x", ar: "x" }, status: "APPROVED" },
    ]);

    const result = await getReviewsForProduct(product._id.toString());
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.title.en).toBe("Great");
  });
});

describe("getPage", () => {
  it("throws NotFoundError for an unpublished page", async () => {
    await PageModel.create({ slug: "draft", title: { en: "x", ar: "x" }, content: { en: "x", ar: "x" }, published: false });
    await expect(getPage("draft")).rejects.toThrow();
  });

  it("returns a published page with localized content", async () => {
    await PageModel.create({ slug: "about", title: { en: "About", ar: "من نحن" }, content: { en: "We sell things.", ar: "نحن نبيع." }, published: true });

    const page = await getPage("about");
    expect(page.title.ar).toBe("من نحن");
  });

  it("carries the page version the storefront shows beside terms it asks a customer to accept (D-13)", async () => {
    await PageModel.create({ slug: "terms", title: { en: "Terms", ar: "الشروط" }, content: { en: "Terms.", ar: "الشروط." }, published: true, version: 4 });
    expect((await getPage("terms")).version).toBe(4);
  });

  it("reports version 1 for a page written before versioning existed", async () => {
    await PageModel.collection.insertOne({ slug: "legacy", title: { en: "x", ar: "x" }, content: { en: "x", ar: "x" }, published: true, seo: {} });
    expect((await getPage("legacy")).version).toBe(1);
  });
});
