import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { Money, ImageAsset } from "@kira-joo/toolkit-common";
import { productRepository, variantRepository } from "../../core/repositories";
import type { UnitOfMeasure, VariantSchema } from "../../catalog/variant.schema";
import { maintainProductListingRollup } from "../../catalog/rollups/maintain-product-listing";
import { buildVariantKey } from "../../catalog/variant-key";

/** No `stock`: it moves only through `adjustStock`, which records the movement. */
export interface UpdateVariantInput {
  sku?: string;
  optionValues?: Array<{ key: string; value: string }>;
  price?: Money;
  compareAtPrice?: Money;
  lowStockThreshold?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  unitOfMeasure?: UnitOfMeasure;
  unitsPerSale?: number;
  costPrice?: Money;
  galleryOverride?: ImageAsset[];
  backorderPolicy?: "DENY" | "CONTINUE_SELLING";
  discontinued?: boolean;
}

/** Fields the listing rollup is derived from — anything else skips the recompute. */
const ROLLUP_RELEVANT_FIELDS = ["price", "discontinued", "backorderPolicy", "galleryOverride"] as const;

export async function updateVariant(variantId: string, input: UpdateVariantInput): Promise<VariantSchema> {
  const variant = await variantRepository.findOne({ where: { _id: variantId } });

  if (input.sku && input.sku !== variant.sku) {
    const existing = await variantRepository.findOne({
      where: { sku: input.sku, _id: { $ne: variantId } },
      skipThrowError: true,
    });
    if (existing) {
      throw new ConflictError("Variant SKU already exists");
    }
  }

  let variantKey: string | undefined;
  if (input.optionValues) {
    const product = await productRepository.findOne({ where: { _id: variant.productId }, skipThrowError: true });
    if (!product) {
      throw new NotFoundError("Product not found");
    }

    const axisKeys = new Set(product.optionAxes.map((axis) => axis.key));
    const valueKeys = new Set(input.optionValues.map((ov) => ov.key));
    const missing = [...axisKeys].filter((key) => !valueKeys.has(key));
    const extra = [...valueKeys].filter((key) => !axisKeys.has(key));
    if (missing.length > 0 || extra.length > 0) {
      throw new ConflictError(
        `Variant option values must match the product's option axes exactly (missing: ${missing.join(", ") || "none"}, unexpected: ${extra.join(", ") || "none"})`
      );
    }

    variantKey = buildVariantKey(variant.productId.toString(), input.optionValues);
    if (variantKey !== variant.variantKey) {
      const existingKey = await variantRepository.findOne({
        where: { variantKey, _id: { $ne: variantId } },
        skipThrowError: true,
      });
      if (existingKey) {
        throw new ConflictError("A variant with this exact option combination already exists");
      }
    }
  }

  const needsRollup = ROLLUP_RELEVANT_FIELDS.some((field) => input[field] !== undefined);

  const patch: Record<string, unknown> = {};
  if (input.sku !== undefined) patch.sku = input.sku;
  if (input.optionValues !== undefined) {
    patch.optionValues = input.optionValues;
    patch.variantKey = variantKey;
  }
  if (input.price !== undefined) patch.price = input.price;
  if (input.compareAtPrice !== undefined) patch.compareAtPrice = input.compareAtPrice;
  if (input.lowStockThreshold !== undefined) patch.lowStockThreshold = input.lowStockThreshold;
  if (input.weight !== undefined) patch.weight = input.weight;
  if (input.length !== undefined) patch.length = input.length;
  if (input.width !== undefined) patch.width = input.width;
  if (input.height !== undefined) patch.height = input.height;
  if (input.unitOfMeasure !== undefined) patch.unitOfMeasure = input.unitOfMeasure;
  if (input.unitsPerSale !== undefined) patch.unitsPerSale = input.unitsPerSale;
  if (input.costPrice !== undefined) patch.costPrice = input.costPrice;
  if (input.galleryOverride !== undefined) patch.galleryOverride = input.galleryOverride;
  if (input.backorderPolicy !== undefined) patch.backorderPolicy = input.backorderPolicy;
  if (input.discontinued !== undefined) patch.discontinued = input.discontinued;

  if (!needsRollup) {
    return variantRepository.update({ where: { _id: variantId } }, patch);
  }

  return withTransaction(async (tx) => {
    const updated = await variantRepository.update({ where: { _id: variantId } }, patch);
    await maintainProductListingRollup(variant.productId);

    return tx.complete(updated);
  });
}
