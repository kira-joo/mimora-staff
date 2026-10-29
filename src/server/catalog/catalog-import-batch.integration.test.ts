// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { CatalogImportBatchModel } from "./catalog-import-batch.schema";

process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await CatalogImportBatchModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
});

describe("CatalogImportBatch", () => {
  it("stages a batch, defaulting to STAGED with no publishedBy/publishedAt", async () => {
    const batch = await CatalogImportBatchModel.create({
      rows: [{ sku: "A", price: "10.00" }],
      stagedBy: new mongoose.Types.ObjectId(),
    });

    expect(batch.status).toBe("STAGED");
    expect(batch.rowErrors).toEqual([]);
    expect(batch.publishedBy).toBeUndefined();
    expect(batch.publishedAt).toBeUndefined();
  });

  it("transitions to PUBLISHED, recording who and when — this is what POST /catalog/publish (MDS §12) writes to", async () => {
    const batch = await CatalogImportBatchModel.create({ rows: [{ sku: "A" }], stagedBy: new mongoose.Types.ObjectId() });
    const publisher = new mongoose.Types.ObjectId();
    const publishedAt = new Date();

    await CatalogImportBatchModel.updateOne({ _id: batch._id }, { $set: { status: "PUBLISHED", publishedBy: publisher, publishedAt } });

    const updated = await CatalogImportBatchModel.findById(batch._id).lean();
    expect(updated?.status).toBe("PUBLISHED");
    expect(updated?.publishedBy?.toString()).toBe(publisher.toString());
  });

  it("carries staging errors without blocking the stage itself — validation errors are recorded, not thrown", async () => {
    const batch = await CatalogImportBatchModel.create({
      rows: [{ sku: "A" }, { sku: "" }],
      rowErrors: [{ row: 2, message: "sku is required" }],
      stagedBy: new mongoose.Types.ObjectId(),
    });

    expect(batch.rowErrors).toHaveLength(1);
    expect(batch.status).toBe("STAGED"); // errors present, still stageable — publish is the route's own gate, not this schema's
  });
});
