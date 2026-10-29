import mongoose from "mongoose";
import { ConflictError } from "@kira-joo/backend-toolkit-core";
import { toMoney } from "@kira-joo/toolkit-common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "../../core/db/connect";
import { CategoryModel } from "../../catalog/category.schema";
import { ProductModel } from "../../catalog/product.schema";
import { VariantModel } from "../../catalog/variant.schema";
import { createVariant } from "../variants/create-variant";
import { deleteVariant } from "../variants/delete-variant";
import { updateVariant } from "../variants/update-variant";
import { createProduct } from "./create-product";
import { updateProduct } from "./update-product";

/**
 * MDS §8/§13: option-axis keys are immutable once a product has variants —
 * every variant carries exactly one value per key. A key change is refused;
 * display names and order stay editable; nothing ever rewrites a variant.
 */
process.env.MONGODB_URI ??= "mongodb://localhost:27020/store-platform-staff-test?replicaSet=rs0&directConnection=true";
process.env.MONGODB_DB ??= "store-platform-staff-test";

const name = (en: string, ar = "") => ({ en, ar });
const axis = (key: string, label = key) => ({ key, name: name(label) });

let categoryId: string;
let sequence = 0;

async function productWithAxes(...keys: string[]) {
  return createProduct({ name: name("Shirt"), description: name(""), slug: `shirt-${++sequence}-${Date.now()}`, categoryId, optionAxes: keys.map((key) => axis(key)) });
}

async function addVariant(productId: string, values: Record<string, string>) {
  return createVariant({
    productId,
    sku: `SKU-${++sequence}-${Date.now()}`,
    optionValues: Object.entries(values).map(([key, value]) => ({ key, value })),
    price: toMoney("100"),
    stock: 1,
  });
}

/** The invariant itself: every variant of the product carries exactly the product's axis keys. */
async function expectConsistent(productId: string) {
  const product = await ProductModel.findById(productId).lean();
  const axisKeys = (product?.optionAxes ?? []).map((a) => a.key).sort();
  const variants = await VariantModel.find({ productId }).lean();
  for (const variant of variants) expect(variant.optionValues.map((ov) => ov.key).sort()).toEqual(axisKeys);
}

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Promise.all([ProductModel.deleteMany({}), VariantModel.deleteMany({}), CategoryModel.deleteMany({})]);
  categoryId = (await CategoryModel.create({ name: name("Shirts"), slug: `shirts-${Date.now()}`, published: true, sortOrder: 0 }))._id.toString();
});

describe("with variants, axis keys cannot change", () => {
  it.each([
    ["adding a key", ["size", "colour", "fit"]],
    ["removing a key", ["size"]],
    ["renaming a key", ["size", "shade"]],
  ])("refuses %s, and changes neither the product nor its variants", async (_, nextKeys) => {
    const product = await productWithAxes("size", "colour");
    await addVariant(product._id.toString(), { size: "M", colour: "Olive" });

    await expect(updateProduct(product._id.toString(), { optionAxes: nextKeys.map((key) => axis(key)) })).rejects.toThrow(ConflictError);

    expect((await ProductModel.findById(product._id).lean())?.optionAxes.map((a) => a.key)).toEqual(["size", "colour"]);
    expect((await VariantModel.findOne({ productId: product._id }).lean())?.optionValues).toEqual([
      { key: "size", value: "M" },
      { key: "colour", value: "Olive" },
    ]);
  });

  it("counts a discontinued variant too — it still carries the old keys", async () => {
    const product = await productWithAxes("size");
    const variant = await addVariant(product._id.toString(), { size: "M" });
    await updateVariant(variant._id.toString(), { discontinued: true });
    await expect(updateProduct(product._id.toString(), { optionAxes: [axis("fit")] })).rejects.toThrow(ConflictError);
  });

  it("allows renaming a display name and reordering axes", async () => {
    const product = await productWithAxes("size", "colour");
    await addVariant(product._id.toString(), { size: "M", colour: "Olive" });

    const updated = await updateProduct(product._id.toString(), { optionAxes: [axis("colour", "Shade"), axis("size", "Fit size")] });
    expect(updated.optionAxes.map((a) => [a.key, a.name.en])).toEqual([
      ["colour", "Shade"],
      ["size", "Fit size"],
    ]);
    await expectConsistent(product._id.toString());
  });

  it("allows any other edit while variants exist", async () => {
    const product = await productWithAxes("size");
    await addVariant(product._id.toString(), { size: "M" });
    const updated = await updateProduct(product._id.toString(), { name: name("Linen shirt"), optionAxes: [axis("size")] });
    expect(updated.name.en).toBe("Linen shirt");
  });
});

describe("without variants, axis keys are free to change", () => {
  it("allows adding, removing and renaming keys", async () => {
    const product = await productWithAxes("size");
    const updated = await updateProduct(product._id.toString(), { optionAxes: [axis("fit"), axis("colour")] });
    expect(updated.optionAxes.map((a) => a.key)).toEqual(["fit", "colour"]);
  });

  it("allows it again once every variant is deleted", async () => {
    const product = await productWithAxes("size");
    const variant = await addVariant(product._id.toString(), { size: "M" });
    await deleteVariant(variant._id.toString());
    await expect(updateProduct(product._id.toString(), { optionAxes: [axis("fit")] })).resolves.toBeDefined();
  });

  it("a variant created after a key change must use the new keys", async () => {
    const product = await productWithAxes("size");
    await updateProduct(product._id.toString(), { optionAxes: [axis("fit")] });
    await expect(addVariant(product._id.toString(), { size: "M" })).rejects.toThrow(ConflictError);
    await expect(addVariant(product._id.toString(), { fit: "Slim" })).resolves.toBeDefined();
    await expectConsistent(product._id.toString());
  });
});

describe("a key change racing a variant creation", () => {
  it("never leaves a variant whose keys differ from its product's", async () => {
    for (let round = 0; round < 8; round += 1) {
      const product = await productWithAxes("size");
      const id = product._id.toString();
      const outcomes = await Promise.allSettled([addVariant(id, { size: "M" }), updateProduct(id, { optionAxes: [axis("fit")] })]);
      // Either may win, or both may succeed in the safe order (key change, then the variant is refused) — never an inconsistent pair.
      expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
      await expectConsistent(id);
    }
  });
});
