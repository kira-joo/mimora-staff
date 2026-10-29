// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "../core/db/connect";
import { BrandModel } from "./brand.schema";
import { CategoryModel } from "./category.schema";
import { CollectionModel } from "./collection.schema";

/**
 * A slug is the URL of a category, brand or collection landing page. Two with
 * one slug make the storefront's `find(slug)` pick whichever it meets first, so
 * uniqueness has to be the index — an app-level pre-check races (and a bulk path
 * skips it). `connectToDatabase` builds the indexes and refuses to start if one
 * is missing, so these hold in the running app, not only in this test.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const wipe = () => Promise.all([CategoryModel.deleteMany({}), BrandModel.deleteMany({}), CollectionModel.deleteMany({})]);
beforeAll(connectToDatabase);
afterEach(wipe);
afterAll(async () => {
  await wipe();
  await mongoose.disconnect();
});

describe.each([
  ["Category", CategoryModel],
  ["Brand", BrandModel],
  ["Collection", CollectionModel],
] as const)("%s slug", (_name, Model) => {
  const make = (slug: string) => (Model as unknown as mongoose.Model<{ slug: string }>).create({ slug });

  it("is unique at the database", async () => {
    await make("same");
    await expect(make("same")).rejects.toMatchObject({ code: 11000 });
    expect(await (Model as mongoose.Model<unknown>).countDocuments({})).toBe(1);
  });

  it("allows different slugs", async () => {
    await make("one");
    await make("two");
    expect(await (Model as mongoose.Model<unknown>).countDocuments({})).toBe(2);
  });

  it("DECLARES a unique index on slug — the schema, not merely whatever a long-lived database happens to hold", () => {
    const declared = (Model as mongoose.Model<unknown>).schema.indexes().find(([keys]) => JSON.stringify(keys) === JSON.stringify({ slug: 1 }));
    expect(declared?.[1]?.unique).toBe(true);
  });
});
