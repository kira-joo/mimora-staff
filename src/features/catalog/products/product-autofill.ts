import type { LocalizedText } from "src/api/brands.endpoints";
import type { Product } from "src/api/products.endpoints";

/** Appended to every generated SEO title, in both languages. */
export const SEO_TITLE_BRAND = "Mimora";

/** `CreateProductDto.slug` is `@MaxLength(200)`. */
const MAX_SLUG_LENGTH = 200;

const LOCALES = ["en", "ar"] as const;

/**
 * The storefront address for an English product name: lower-case Latin letters and digits joined by single dashes.
 * Accents are folded (`Café` → `cafe`), apostrophes dropped (`Women's` → `womens`), anything else is a separator.
 * A name with no Latin letters or digits gives `""` — staff type that slug by hand.
 */
export function productSlug(englishName: string): string {
  const slug = englishName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > MAX_SLUG_LENGTH ? slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "") : slug;
}

/** `"<name> | Mimora"`, or `""` while the name is empty. */
export function seoTitleFor(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `${trimmed} | ${SEO_TITLE_BRAND}` : "";
}

export interface AutofillTargets {
  slug: string;
  seoTitle: LocalizedText;
}

/**
 * What a name change should rewrite on a new product. A field follows the name only while it still holds exactly
 * what the PREVIOUS name generated — so the first manual edit (including clearing it) detaches it for good, and a
 * value staff typed is never overwritten. Returns only the fields that change.
 */
export function autofillFromName(previous: LocalizedText, next: LocalizedText, current: AutofillTargets): Partial<{ slug: string; "seoTitle.en": string; "seoTitle.ar": string }> {
  const changes: Partial<{ slug: string; "seoTitle.en": string; "seoTitle.ar": string }> = {};
  if (current.slug === productSlug(previous.en ?? "")) {
    const slug = productSlug(next.en ?? "");
    if (slug !== current.slug) changes.slug = slug;
  }
  for (const locale of LOCALES) {
    const title = current.seoTitle?.[locale] ?? "";
    if (title !== seoTitleFor(previous[locale] ?? "")) continue;
    const generated = seoTitleFor(next[locale] ?? "");
    if (generated !== title) changes[`seoTitle.${locale}`] = generated;
  }
  return changes;
}

/** The product-form fields a clone starts from. Deliberately excludes everything a clone must not inherit. */
export type ProductCloneValues = Pick<Product, "name" | "description" | "slug" | "categoryId" | "collectionIds" | "brandId" | "sizeGuide" | "optionAxes" | "attributes" | "seoTitle" | "seoDescription">;

/**
 * A new product's starting values, copied from `source`'s product-level content: names, descriptions, placement,
 * option axes, attributes and SEO text. NOT copied: id, variants, SKUs, prices, stock, images, lifecycle and
 * schedule — the create body has no field for any of them, and the server starts every new product as a draft.
 *
 * Every value is a deep copy, so editing the clone's attributes or collections can never reach the source's objects
 * (the query cache still holds them). The slug and SEO titles are regenerated from the copied names, so they keep
 * following the name as staff rename the copy; a source SEO title staff customised is kept as it was.
 */
export function cloneProductValues(source: Product): ProductCloneValues {
  const copy = structuredClone({
    name: source.name,
    description: source.description,
    categoryId: source.categoryId,
    collectionIds: source.collectionIds ?? [],
    brandId: source.brandId,
    sizeGuide: source.sizeGuide,
    optionAxes: source.optionAxes ?? [],
    attributes: source.attributes ?? [],
    seoTitle: source.seoTitle ?? { en: "", ar: "" },
    seoDescription: source.seoDescription ?? { en: "", ar: "" },
  });
  return {
    ...copy,
    slug: productSlug(copy.name.en ?? ""),
    seoTitle: {
      en: copy.seoTitle.en || seoTitleFor(copy.name.en ?? ""),
      ar: copy.seoTitle.ar || seoTitleFor(copy.name.ar ?? ""),
    },
  };
}
