import { describe, expect, it } from "vitest";
import { groupKey, parseCatalog } from "./catalog.mjs";
import { product } from "./test-fixtures.mjs";

const group = (members, name = { en: "G", ar: "ج" }) => ({ groupName: name, membersInStorefrontOrder: members.map(([productSlug, en, ar]) => ({ productSlug, label: { en, ar } })) });

describe("parseCatalog", () => {
  it("accepts the documented shape and keeps file order", () => {
    const parsed = parseCatalog({ products: [product("a"), product("b")], productGroupAssignmentSteps: [group([["b", "B", "ب"], ["a", "A", "أ"]])] });
    expect(parsed.errors).toEqual([]);
    expect(parsed.products.map((p) => [p.slug, p.images])).toEqual([["a", ["a.jpg"]], ["b", ["b.jpg"]]]);
    expect(parsed.groups[0].members.map((m) => m.productSlug)).toEqual(["b", "a"]);
    expect(parsed.groups[0].key).toBe(groupKey({ en: "G", ar: "ج" }));
  });

  it("accepts a gallery (sourceImageFilenames) but not both forms", () => {
    expect(parseCatalog({ products: [product("a", { entry: { sourceImageFilename: undefined, sourceImageFilenames: ["1.jpg", "2.jpg"] } })] }).products[0].images).toEqual(["1.jpg", "2.jpg"]);
    expect(parseCatalog({ products: [product("a", { entry: { sourceImageFilenames: ["1.jpg"] } })] }).errors).toContain('products[0]: give "sourceImageFilename" or "sourceImageFilenames", not both.');
  });

  it.each([
    ["a missing image name", product("a", { entry: { sourceImageFilename: "" } }), '"sourceImageFilename" is required'],
    ["an images key on the product", product("a", { product: { images: [] } }), "images come from the image files"],
    ["an unknown product key", product("a", { product: { price: "1" } }), 'unknown product key "price"'],
    ["a bad slug", product("A B"), "slug must be lowercase"],
    ["a missing Arabic name", product("a", { product: { name: { en: "A", ar: "" } } }), 'name needs both "en" and "ar"'],
    ["a bad category id", product("a", { product: { categoryId: "nope" } }), "categoryId must be a 24-character id"],
    ["a bad collection id", product("a", { product: { collectionIds: ["x"] } }), "collectionIds must be an array of 24-character ids"],
    ["no lifecycle", product("a", { product: { lifecycle: undefined } }), "lifecycle must be one of"],
    ["no variants", product("a", { variants: [] }), "at least one variant is required"],
    ["a numeric price", product("a", { variants: [{ sku: "S", optionValues: [], price: 100, stock: 1 }] }), "price must be a decimal string"],
    ["a negative stock", product("a", { variants: [{ sku: "S", optionValues: [], price: "1.00", stock: -1 }] }), "stock must be a whole number"],
    ["option values without options", product("a", { variants: [{ sku: "S", optionValues: [{ key: "size", value: "M" }], price: "1.00", stock: 1 }] }), "one value for each of the product's options"],
    ["an unknown variant key", product("a", { variants: [{ sku: "S", optionValues: [], price: "1.00", stock: 1, productId: "x" }] }), 'unknown variant key "productId"'],
  ])("refuses %s", (_label, entry, message) => {
    expect(parseCatalog({ products: [entry] }).errors.join(" ")).toContain(message);
  });

  it("refuses several variants without options, and two variants with one option combination", () => {
    const two = [{ sku: "S1", optionValues: [], price: "1.00", stock: 1 }, { sku: "S2", optionValues: [], price: "1.00", stock: 1 }];
    expect(parseCatalog({ products: [product("a", { variants: two })] }).errors.join(" ")).toContain("a product without options can have only one variant");
    const sized = product("b", {
      product: { optionAxes: [{ key: "size", name: { en: "Size", ar: "المقاس" } }] },
      variants: [{ sku: "B-S", optionValues: [{ key: "size", value: "S" }], price: "1.00", stock: 1 }, { sku: "B-S2", optionValues: [{ key: "size", value: "s" }], price: "1.00", stock: 1 }],
    });
    expect(parseCatalog({ products: [sized] }).errors.join(" ")).toContain("the same option values as variant B-S");
  });

  it("refuses a slug or SKU used twice in the file", () => {
    const errors = parseCatalog({ products: [product("a"), product("a", { variants: [{ sku: "SKU-a", optionValues: [], price: "1.00", stock: 1 }] })] }).errors.join(" ");
    expect(errors).toContain('slug "a" is used twice');
    expect(errors).toContain('SKU "SKU-a" is also used by a');
  });

  it("refuses group members that are not in the file, a product in two groups, and duplicate or missing labels", () => {
    const errors = parseCatalog({
      products: [product("a"), product("b")],
      productGroupAssignmentSteps: [group([["a", "A", "أ"], ["zzz", "Z", "ز"]]), group([["a", "A2", "أ2"], ["b", "a2", "ب"]], { en: "H", ar: "ح" }), group([["b", "", "ب"]], { en: "I", ar: "ط" })],
    }).errors.join(" ");
    expect(errors).toContain('"zzz" is not a product in this file');
    expect(errors).toContain('"a" is already in group "G"');
    expect(errors).toContain('label.en "a2" is used twice in this group');
    expect(errors).toContain('label needs "en"');
  });

  it("warns (does not refuse) a one-product group", () => {
    const parsed = parseCatalog({ products: [product("a")], productGroupAssignmentSteps: [group([["a", "A", "أ"]])] });
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings[0]).toContain("one product");
  });

  it("refuses a non-object file", () => {
    expect(parseCatalog([]).errors).toEqual(['catalog.json must be a JSON object with a "products" array.']);
  });
});
