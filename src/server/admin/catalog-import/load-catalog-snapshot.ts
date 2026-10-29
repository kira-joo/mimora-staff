import { brandRepository, categoryRepository, productRepository, variantRepository } from "../../core/repositories";
import { getStoreDefaultLocale } from "../../content/default-locale";
import type { CatalogSnapshot, ExistingProduct, ExistingVariant } from "./plan-catalog-import";
import type { ImportProduct } from "./import-types";

/**
 * Reads what the catalog holds for exactly the slugs and SKUs a staged batch mentions — never the whole catalog.
 * Reads join the ambient transaction, so called inside `withTransaction` (publish) it sees one consistent state.
 */
export async function loadCatalogSnapshot(products: readonly ImportProduct[]): Promise<CatalogSnapshot> {
  const slugs = products.map((product) => product.slug);
  const categorySlugs = [...new Set(products.flatMap((product) => (product.categorySlug ? [product.categorySlug] : [])))];
  const brandSlugs = [...new Set(products.flatMap((product) => (product.brandSlug ? [product.brandSlug] : [])))];
  const skus = [...new Set(products.flatMap((product) => product.variants.map((variant) => variant.sku)))];

  // Sequential, not Promise.all: a transaction session cannot run concurrent operations.
  const defaultLocale = await getStoreDefaultLocale();
  const categories = categorySlugs.length ? await categoryRepository.findAll({ where: { slug: { $in: categorySlugs } } }) : [];
  const brands = brandSlugs.length ? await brandRepository.findAll({ where: { slug: { $in: brandSlugs } } }) : [];
  const existingProducts = slugs.length ? await productRepository.findAll({ where: { slug: { $in: slugs } } }) : [];
  const variantsOfThese = existingProducts.length ? await variantRepository.findAll({ where: { productId: { $in: existingProducts.map((product) => product._id) } } }) : [];
  const skuHits = skus.length ? await variantRepository.findAll({ where: { sku: { $in: skus } } }) : [];

  const variantsByProduct = new Map<string, Map<string, ExistingVariant>>();
  for (const variant of variantsOfThese) {
    const key = variant.productId.toString();
    const bucket = variantsByProduct.get(key) ?? new Map<string, ExistingVariant>();
    bucket.set(variant.sku, { id: variant._id.toString(), optionValues: variant.optionValues.map(({ key: k, value }) => ({ key: k, value })), stock: variant.stock });
    variantsByProduct.set(key, bucket);
  }

  const productsBySlug = new Map<string, ExistingProduct>();
  const slugById = new Map<string, string>();
  for (const product of existingProducts) {
    slugById.set(product._id.toString(), product.slug);
    productsBySlug.set(product.slug, {
      id: product._id.toString(),
      lifecycle: product.lifecycle,
      name: { ar: product.name.ar, en: product.name.en },
      description: { ar: product.description.ar, en: product.description.en },
      categoryId: product.categoryId.toString(),
      brandId: product.brandId?.toString(),
      optionAxes: product.optionAxes.map((axis) => ({
        key: axis.key,
        name: { ar: axis.name.ar, en: axis.name.en },
        values: axis.values?.map((value) => ({ key: value.key, label: { ar: value.label.ar, en: value.label.en }, ...(value.swatch ? { swatch: value.swatch } : {}) })),
      })),
      attributes: product.attributes.map((attribute) => ({
        key: attribute.key,
        name: { ar: attribute.name.ar, en: attribute.name.en },
        values: attribute.values.map((value) => ({ key: value.key, value: { ar: value.value.ar, en: value.value.en } })),
      })),
      variants: variantsByProduct.get(product._id.toString()) ?? new Map(),
    });
  }

  // A SKU hit on a product outside the file's slugs needs that product's slug to name it in the error.
  const strangers = [...new Set(skuHits.map((variant) => variant.productId.toString()).filter((id) => !slugById.has(id)))];
  const strangerProducts = strangers.length ? await productRepository.findAll({ where: { _id: { $in: strangers } } }) : [];
  for (const product of strangerProducts) slugById.set(product._id.toString(), product.slug);

  return {
    defaultLocale,
    categories: new Map(categories.map((category) => [category.slug, { id: category._id.toString() }])),
    brands: new Map(brands.map((brand) => [brand.slug, { id: brand._id.toString() }])),
    products: productsBySlug,
    skuOwners: new Map(skuHits.map((variant) => [variant.sku, { productId: variant.productId.toString(), productSlug: slugById.get(variant.productId.toString()) ?? "(unknown product)" }])),
  };
}
