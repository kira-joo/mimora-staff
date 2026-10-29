import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import type { ProductSchema } from "../catalog/product.schema";
import { inventorySettingsRepository, productRepository, variantRepository } from "../core/repositories";
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
  return { product, variants: buildVariantMatrix(matrixVariants) as StorefrontMatrixVariant[] };
}
