import { describe, expect, it } from "vitest";
import type { Product } from "src/api/products.endpoints";
import { autofillFromName, cloneProductValues, productSlug, seoTitleFor } from "./product-autofill";

const EN = "Golden Heart Pendant Necklace";
const AR = "سلسلة بدلاية قلب ذهبي";

describe("productSlug", () => {
  it("lower-cases and dashes the English name", () => {
    expect(productSlug(EN)).toBe("golden-heart-pendant-necklace");
  });

  it("folds accents, drops apostrophes, collapses separators and trims dashes", () => {
    expect(productSlug("  Café Crème — 18K  ")).toBe("cafe-creme-18k");
    expect(productSlug("Women's  Ring / Gold")).toBe("womens-ring-gold");
    expect(productSlug("--Hello__World--")).toBe("hello-world");
  });

  it("gives an empty slug for a name with no Latin letters or digits", () => {
    expect(productSlug(AR)).toBe("");
    expect(productSlug("")).toBe("");
  });

  it("keeps digits and fits 200 characters without a trailing dash", () => {
    expect(productSlug("Ring 2 Size 52")).toBe("ring-2-size-52");
    const long = productSlug(`${"word ".repeat(60)}`);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith("-")).toBe(false);
  });
});

describe("seoTitleFor", () => {
  it("appends | Mimora in both languages", () => {
    expect(seoTitleFor(EN)).toBe("Golden Heart Pendant Necklace | Mimora");
    expect(seoTitleFor(AR)).toBe("سلسلة بدلاية قلب ذهبي | Mimora");
  });

  it("is empty while the name is empty, and trims", () => {
    expect(seoTitleFor("  ")).toBe("");
    expect(seoTitleFor(" Ring ")).toBe("Ring | Mimora");
  });
});

describe("autofillFromName", () => {
  const empty = { en: "", ar: "" };
  const blank = { slug: "", seoTitle: { en: "", ar: "" } };

  it("fills slug and both SEO titles as the names are typed", () => {
    expect(autofillFromName(empty, { en: EN, ar: "" }, blank)).toEqual({ slug: "golden-heart-pendant-necklace", "seoTitle.en": "Golden Heart Pendant Necklace | Mimora" });
    expect(autofillFromName(empty, { en: "", ar: AR }, blank)).toEqual({ "seoTitle.ar": "سلسلة بدلاية قلب ذهبي | Mimora" });
  });

  it("keeps following while the fields still hold what the previous name generated", () => {
    const current = { slug: "golden-heart", seoTitle: { en: "Golden Heart | Mimora", ar: "" } };
    expect(autofillFromName({ en: "Golden Heart", ar: "" }, { en: "Golden Heart Ring", ar: "" }, current)).toEqual({ slug: "golden-heart-ring", "seoTitle.en": "Golden Heart Ring | Mimora" });
  });

  it("never overwrites a slug or SEO title staff edited", () => {
    const current = { slug: "my-custom-slug", seoTitle: { en: "Gift for her — Mimora", ar: "عنوان مخصص" } };
    expect(autofillFromName({ en: "Golden Heart", ar: "قلب" }, { en: "Golden Heart Ring", ar: "قلب ذهبي" }, current)).toEqual({});
  });

  it("detaches each field independently", () => {
    const current = { slug: "my-custom-slug", seoTitle: { en: "Golden Heart | Mimora", ar: "عنوان مخصص" } };
    expect(autofillFromName({ en: "Golden Heart", ar: "قلب" }, { en: "Golden Ring", ar: "خاتم" }, current)).toEqual({ "seoTitle.en": "Golden Ring | Mimora" });
  });

  it("treats a field staff cleared as edited, not as empty to refill", () => {
    const current = { slug: "", seoTitle: { en: "", ar: "" } };
    expect(autofillFromName({ en: "Golden Heart", ar: "قلب" }, { en: "Golden Heart Ring", ar: "قلب ذهبي" }, current)).toEqual({});
  });

  it("clears generated values when the name is cleared", () => {
    const current = { slug: "ring", seoTitle: { en: "Ring | Mimora", ar: "" } };
    expect(autofillFromName({ en: "Ring", ar: "" }, empty, current)).toEqual({ slug: "", "seoTitle.en": "" });
  });
});

const source: Product = {
  _id: "6af095afb751f2dc5b2bd08a",
  name: { en: EN, ar: AR },
  description: { en: "A heart pendant.", ar: "قلادة قلب." },
  slug: "golden-heart-pendant-necklace",
  categoryId: "6ae9b377431804dc15cf0001",
  collectionIds: ["6ae9b377431804dc15cf0011", "6ae9b377431804dc15cf0012"],
  brandId: "6ae9b377431804dc15cf0021",
  sizeGuide: null,
  images: [{ provider: "cloudinary", publicId: "mimora/store/products/a", secureUrl: "https://res.example/a.png", format: "png", width: 1, height: 1, bytes: 1 } as never],
  optionAxes: [{ key: "length", name: { en: "Length", ar: "الطول" }, values: [{ key: "45", label: { en: "45 cm", ar: "45 سم" } }] }],
  attributes: [
    { key: "material", name: { en: "Material", ar: "الخامة" }, values: [{ key: "gold", value: { en: "Gold", ar: "ذهب" } }] },
    { key: "stone", name: { en: "Stone", ar: "الحجر" }, values: [{ key: "zircon", value: { en: "Zircon", ar: "زركون" } }, { key: "pearl", value: { en: "Pearl", ar: "لؤلؤ" } }] },
  ],
  seoTitle: { en: "", ar: "" },
  seoDescription: { en: "Shop the golden heart.", ar: "تسوقي القلب الذهبي." },
  lifecycle: "published",
  publishAt: "2026-11-01T00:00:00.000Z",
  order: 7,
  listing: { minActivePrice: "250.00", maxActivePrice: "300.00", purchasableVariantCount: 3 },
};

describe("cloneProductValues", () => {
  it("copies the product-level content: names, descriptions, category, collections, brand, size guide, options, attributes, SEO description", () => {
    const clone = cloneProductValues(source);
    expect(clone).toMatchObject({
      name: source.name,
      description: source.description,
      categoryId: source.categoryId,
      collectionIds: source.collectionIds,
      brandId: source.brandId,
      sizeGuide: null,
      optionAxes: source.optionAxes,
      attributes: source.attributes,
      seoDescription: source.seoDescription,
    });
  });

  it("copies nothing a new product must not inherit: id, images, lifecycle, schedule, order, listing (prices, stock)", () => {
    const clone = cloneProductValues(source) as Record<string, unknown>;
    for (const key of ["_id", "images", "lifecycle", "publishAt", "order", "listing", "updatedAt", "createdAt"]) expect(clone).not.toHaveProperty(key);
  });

  it("regenerates the slug and fills empty SEO titles from the names", () => {
    const clone = cloneProductValues(source);
    expect(clone.slug).toBe("golden-heart-pendant-necklace");
    expect(clone.seoTitle).toEqual({ en: "Golden Heart Pendant Necklace | Mimora", ar: "سلسلة بدلاية قلب ذهبي | Mimora" });
  });

  it("keeps a source SEO title staff customised", () => {
    expect(cloneProductValues({ ...source, seoTitle: { en: "Gift for her", ar: "" } }).seoTitle).toEqual({ en: "Gift for her", ar: "سلسلة بدلاية قلب ذهبي | Mimora" });
  });

  it("shares no mutable reference with the source: editing the clone leaves the source untouched", () => {
    const before = structuredClone(source);
    const clone = cloneProductValues(source);
    expect(clone.attributes).not.toBe(source.attributes);
    expect(clone.attributes[0]).not.toBe(source.attributes[0]);
    expect(clone.collectionIds).not.toBe(source.collectionIds);

    clone.name.en = "Silver Heart";
    clone.collectionIds!.push("6ae9b377431804dc15cf0099");
    clone.attributes[0]!.values[0]!.value.en = "Silver";
    clone.attributes[1]!.values.pop();
    clone.optionAxes[0]!.values!.push({ key: "50", label: { en: "50 cm", ar: "50 سم" } });
    clone.seoDescription!.ar = "تغيير";

    expect(source).toEqual(before);
  });
});
