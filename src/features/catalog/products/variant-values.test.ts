import { describe, expect, it } from "vitest";
import type { Variant } from "src/api/variants.endpoints";
import { createVariantBody, optionSummary, variantBody, mapVariantToFormValues } from "./variant-values";

const axes = [
  { key: "colour", name: { en: "Colour", ar: "اللون" } },
  { key: "size", name: { en: "Size", ar: "المقاس" } },
];

const variant: Variant = {
  _id: "v1",
  productId: "p1",
  sku: "TSH-OLV-M",
  optionValues: [
    { key: "size", value: "M" },
    { key: "colour", value: "زيتي Olive" },
  ],
  price: "250.00",
  stock: 3,
  lowStockThreshold: 5,
  unitOfMeasure: "EACH",
  unitsPerSale: 1,
  backorderPolicy: "DENY",
  discontinued: false,
};

describe("mapVariantToFormValues", () => {
  it("lays option values out in the product's axis order", () => {
    expect(mapVariantToFormValues(axes, variant).optionValues).toEqual([
      { key: "colour", value: "زيتي Olive" },
      { key: "size", value: "M" },
    ]);
  });

  it("offers an empty value for an axis the variant lacks", () => {
    const values = mapVariantToFormValues([...axes, { key: "fit", name: { en: "Fit", ar: "" } }], variant);
    expect(values.optionValues[2]).toEqual({ key: "fit", value: "" });
  });

  it("starts a new variant at zero stock, sold one at a time, on the store's inventory policy", () => {
    const values = mapVariantToFormValues(axes);
    expect(values).toMatchObject({ stock: "0", unitsPerSale: "1", unitOfMeasure: "EACH", backorderPolicy: "DEFAULT", price: "" });
  });
});

describe("variantBody", () => {
  it("keeps money as strings and sends blank optional fields as absent", () => {
    const body = variantBody({ ...mapVariantToFormValues(axes, variant), compareAtPrice: " ", costPrice: "120.5", weight: "" });
    expect(body.price).toBe("250.00");
    expect(body.costPrice).toBe("120.5");
    expect(body.compareAtPrice).toBeUndefined();
    expect(body.weight).toBeUndefined();
    expect(body.lowStockThreshold).toBe(5);
  });

  it("treats an optional field the form dropped (undefined) like a blank one", () => {
    const values = { ...mapVariantToFormValues(axes, variant), lowStockThreshold: undefined, weight: undefined, compareAtPrice: undefined } as unknown as Parameters<typeof variantBody>[0];
    const body = variantBody(values);
    expect(body.lowStockThreshold).toBeUndefined();
    expect(body.weight).toBeUndefined();
    expect(body.compareAtPrice).toBeUndefined();
  });

  it("never sends stock on an update — stock moves through inventory adjustments", () => {
    expect(variantBody(mapVariantToFormValues(axes, variant))).not.toHaveProperty("stock");
  });

  it("sends the opening stock, and the product, on a create", () => {
    expect(createVariantBody("p1", { ...mapVariantToFormValues(axes), sku: "X", price: "10", stock: "12" })).toMatchObject({ productId: "p1", stock: 12, sku: "X" });
  });

  it("sends no backorder policy when the form still says \"store default\", so the server applies the store's", () => {
    expect(variantBody(mapVariantToFormValues(axes))).toHaveProperty("backorderPolicy", undefined);
    expect(variantBody({ ...mapVariantToFormValues(axes), backorderPolicy: "CONTINUE_SELLING" }).backorderPolicy).toBe("CONTINUE_SELLING");
    expect(variantBody({ ...mapVariantToFormValues(axes), backorderPolicy: "DENY" }).backorderPolicy).toBe("DENY");
  });

  it("an existing variant edits with its own policy, never \"store default\"", () => {
    expect(mapVariantToFormValues(axes, { ...variant, backorderPolicy: "CONTINUE_SELLING" }).backorderPolicy).toBe("CONTINUE_SELLING");
  });

  it("trims the SKU and option values", () => {
    const body = variantBody({ ...mapVariantToFormValues(axes, variant), sku: " TSH-1 ", optionValues: [{ key: "colour", value: " Olive " }] });
    expect(body.sku).toBe("TSH-1");
    expect(body.optionValues).toEqual([{ key: "colour", value: "Olive" }]);
  });
});

describe("optionSummary", () => {
  it("reads values in axis order", () => {
    expect(optionSummary(axes, variant)).toBe("زيتي Olive · M");
  });

  it("still shows a value whose axis was removed from the product", () => {
    expect(optionSummary([axes[1]!], variant)).toBe("M · زيتي Olive");
  });
});
