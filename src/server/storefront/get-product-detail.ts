import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import type { ProductSchema } from "../catalog/product.schema";
import { MAX_GROUP_MEMBERS } from "../catalog/product-group-rules";
import { inventorySettingsRepository, productRepository, variantRepository } from "../core/repositories";
import { ProductModel } from "../catalog/product.schema";
import { linkedProductsView, type LinkedProductsView } from "./linked-products";
import { MAX_INCLUDED_IMAGES, includedProductsView, type IncludedProductItem } from "./included-products";
import { buildVariantMatrix } from "../engines/variant-matrix/build-variant-matrix";
import type { MatrixVariant } from "../engines/variant-matrix/variant-matrix.types";
import { resolveLowStock } from "../engines/variant-matrix/resolve-low-stock";
import { resolvePurchasability } from "../engines/purchasability/resolve-purchasability";

/** The `InventorySettings.lowStockThreshold` schema default, used only before a store has any settings document. */
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/**
 * The storefront's per-variant projection: the engine's compact matrix plus the
 * display facts the product page needs to be truthful — never admin inventory
 * detail. `stock` itself is NOT here: `onBackorder` says only that a
 * CONTINUE_SELLING variant has nothing on hand (so the page says "available to
 * order", not "in stock"), and the quantity stays private.
 */
export interface StorefrontMatrixVariant extends MatrixVariant {
  sku: string;
  backorderPolicy: "DENY" | "CONTINUE_SELLING";
  /** Purchasable only because the merchant sells past zero: CONTINUE_SELLING with no stock on hand. */
  onBackorder: boolean;
  unitOfMeasure: string;
  unitsPerSale: number;
  /** Colour-specific imagery; empty means the product's own gallery applies. */
  galleryOverride: ImageAsset[];
}

export interface ProductDetailView {
  product: ProductSchema;
  variants: StorefrontMatrixVariant[];
  /**
   * The other published products in this product's group, offered as alternatives (each its own product and page).
   * `null` for an ungrouped product, or a group with no other published member. This is what the storefront renders;
   * `product.group` (the raw membership) is present on grouped products but carries nothing a page needs.
   */
  linkedProducts: LinkedProductsView | null;
  /**
   * The products this product contains ("what's inside" a gift box), resolved at read time from the live product
   * records — so a rename or new image of an included product shows here with no change to this one. Published
   * products only, in stored order; empty when there are none.
   */
  includedProducts: IncludedProductItem[];
}

/**
 * Product detail + the purchasable variant matrix (MDS §11.1: "including
 * the purchasable variant matrix") — reuses the Phase 3 purchasability and
 * variant-matrix engines exactly as built, rather than re-deriving
 * purchasability logic at the route layer.
 *
 * `published` is enforced in the query itself, not as a post-fetch check —
 * a draft/archived product is a 404 here, the same as one that does not
 * exist at all; the storefront has no legitimate reason to distinguish
 * "never existed" from "not currently published."
 */
export async function getProductDetail(slug: string): Promise<ProductDetailView> {
  const product = await productRepository.findOne({ where: { slug, lifecycle: "published" }, skipThrowError: true });
  if (!product) throw new NotFoundError(`Product "${slug}" was not found.`);

  const variants = await variantRepository.findAll({ where: { productId: product._id } });

  const inventorySettings = await inventorySettingsRepository.findOne({ where: {}, skipThrowError: true });
  const defaultThreshold = inventorySettings?.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

  const matrixVariants: StorefrontMatrixVariant[] = variants.map((variant) => {
    const purchasability = resolvePurchasability({
      productLifecycle: product.lifecycle,
      discontinued: variant.discontinued,
      stock: variant.stock,
      backorderPolicy: variant.backorderPolicy,
    });

    return {
      variantId: variant._id.toString(),
      optionValues: variant.optionValues,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      sku: variant.sku,
      backorderPolicy: variant.backorderPolicy ?? "DENY",
      onBackorder: variant.backorderPolicy === "CONTINUE_SELLING" && purchasability.purchasable && variant.stock <= 0,
      unitOfMeasure: variant.unitOfMeasure ?? "EACH",
      unitsPerSale: variant.unitsPerSale ?? 1,
      galleryOverride: variant.galleryOverride ?? [],
      purchasable: purchasability.purchasable,
      lowStock: resolveLowStock({
        purchasable: purchasability.purchasable,
        backorderPolicy: variant.backorderPolicy,
        stock: variant.stock,
        variantThreshold: variant.lowStockThreshold,
        defaultThreshold,
      }),
    };
  });

  // `buildVariantMatrix` asserts the axis cap and returns the same array it was given, so the extra fields survive.
  return {
    product,
    variants: buildVariantMatrix(matrixVariants) as StorefrontMatrixVariant[],
    linkedProducts: await readLinkedProducts(product),
    includedProducts: await readIncludedProducts(product),
  };
}

/** Published members of the product's group, in group order — drafts and archived members never reach a customer. */
async function readLinkedProducts(product: ProductSchema): Promise<LinkedProductsView | null> {
  if (!product.group?.groupId) return null;
  const siblings = await ProductModel.find(
    { "group.groupId": product.group.groupId, lifecycle: "published" },
    { slug: 1, name: 1, images: { $slice: 1 }, "listing.primaryImage": 1, group: 1 }
  )
    .sort({ "group.order": 1, _id: 1 })
    .limit(MAX_GROUP_MEMBERS)
    .lean();
  return linkedProductsView(product._id, siblings);
}


/** The contents' LIVE products, published only (a draft or archived one would 404 and may be unreleased), in stored order. */
async function readIncludedProducts(product: ProductSchema): Promise<IncludedProductItem[]> {
  const contents = product.contents;
  if (!contents || contents.length === 0) return [];
  const published = await ProductModel.find(
    { _id: { $in: contents.map((entry) => entry.productId) }, lifecycle: "published" },
    { slug: 1, name: 1, images: { $slice: MAX_INCLUDED_IMAGES }, "listing.primaryImage": 1 }
  ).lean();
  return includedProductsView(contents, published);
}
