import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { BrandModel } from "../../catalog/brand.schema";
import { listBrands } from "./list-brands";
import { createBrand } from "./create-brand";
import { updateBrand } from "./update-brand";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const LOCALIZED = { ar: "نص", en: "Text" };

describe("Admin Brands", () => {
  beforeAll(async () => {
    await connectToDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await BrandModel.deleteMany({});
  });

  describe("createBrand", () => {
    it("creates a brand with required fields", async () => {
      const brand = await createBrand({ name: LOCALIZED, slug: "acme", description: LOCALIZED });
      expect(brand.slug).toBe("acme");
      expect(brand.published).toBe(false);
    });

    it("throws ConflictError on duplicate slug", async () => {
      await createBrand({ name: LOCALIZED, slug: "dup", description: LOCALIZED });
      await expect(createBrand({ name: LOCALIZED, slug: "dup", description: LOCALIZED })).rejects.toThrow(
        ConflictError
      );
    });
  });

  describe("updateBrand", () => {
    it("updates fields and can publish", async () => {
      const created = await createBrand({ name: LOCALIZED, slug: "to-update", description: LOCALIZED });
      const updated = await updateBrand(created._id.toString(), { published: true });
      expect(updated.published).toBe(true);
    });

    it("throws ConflictError when updating to a duplicate slug", async () => {
      await createBrand({ name: LOCALIZED, slug: "one", description: LOCALIZED });
      const other = await createBrand({ name: LOCALIZED, slug: "two", description: LOCALIZED });
      await expect(updateBrand(other._id.toString(), { slug: "one" })).rejects.toThrow(ConflictError);
    });

    it("throws NotFoundError for a non-existent brand", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await expect(updateBrand(fakeId, { published: true })).rejects.toThrow(NotFoundError);
    });
  });

  describe("listBrands", () => {
    it("filters by published", async () => {
      await createBrand({ name: LOCALIZED, slug: "pub", description: LOCALIZED, published: true });
      await createBrand({ name: LOCALIZED, slug: "unpub", description: LOCALIZED, published: false });

      const published = await listBrands({ limit: 10, page: 1, published: true });
      expect(published.total).toBe(1);

      const all = await listBrands({ limit: 10, page: 1 });
      expect(all.total).toBe(2);
    });
  });
});
