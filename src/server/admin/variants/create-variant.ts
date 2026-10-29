import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import type { Money, ImageAsset } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";
import { inventorySettingsRepository, productRepository, stockMovementRepository, variantRepository } from "../../core/repositories";
import type { UnitOfMeasure } from "../../catalog/variant.schema";
import { getSingletonSettings } from "../settings/singleton-settings";
import type { VariantSchema } from "../../catalog/variant.schema";
import { maintainProductListingRollup } from "../../catalog/rollups/maintain-product-listing";
import { buildVariantKey } from "../../catalog/variant-key";

export interface CreateVariantInput {
  productId: string;
  sku: string;
  optionValues: Array<{ key: string; value: string }>;
  price: Money;
  compareAtPrice?: Money;
  stock: number;
  lowStockThreshold?: number;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  unitOfMeasure?: UnitOfMeasure;
  unitsPerSale?: number;
  costPrice?: Money;
  galleryOverride?: ImageAsset[];
  /** Absent means the store default (`InventorySettings.defaultInventoryPolicy`) — it is read at creation and stored on the variant, so a later change of the default never rewrites existing variants. */
  backorderPolicy?: "DENY" | "CONTINUE_SELLING";
  /** The staff member creating it — the actor on the opening-stock movement. */
  actorId?: string;
}

function assertOptionValuesMatchAxes(
  productAxes: Array<{ key: string }>,
  optionValues: Array<{ key: string; value: string }>
): void {
  const axisKeys = new Set(productAxes.map((axis) => axis.key));
  const valueKeys = new Set(optionValues.map((ov) => ov.key));

  const missing = [...axisKeys].filter((key) => !valueKeys.has(key));
  const extra = [...valueKeys].filter((key) => !axisKeys.has(key));

  if (missing.length > 0 || extra.length > 0) {
    throw new ConflictError(
      `Variant option values must match the product's option axes exactly (missing: ${missing.join(", ") || "none"}, unexpected: ${extra.join(", ") || "none"})`
    );
  }
}

/**
 * Creates a variant and immediately recomputes the parent Product's listing
 * rollup — a multi-collection write, so both go through one transaction
 * (workspace constitution's "every multi-collection write is one
 * transaction"). SKU and `variantKey` uniqueness are checked explicitly
 * up front, matching this codebase's established admin-CRUD pattern
 * (`createProduct`'s slug check) rather than relying solely on the
 * duplicate-key error from the `@Unique()` index.
 */
export async function createVariant(input: CreateVariantInput): Promise<VariantSchema> {
  const product = await productRepository.findOne({ where: { _id: input.productId }, skipThrowError: true });
  if (!product) {
    throw new NotFoundError("Product not found");
  }

  assertOptionValuesMatchAxes(product.optionAxes, input.optionValues);

  const existingSku = await variantRepository.findOne({ where: { sku: input.sku }, skipThrowError: true });
  if (existingSku) {
    throw new ConflictError("Variant SKU already exists");
  }

  const variantKey = buildVariantKey(input.productId, input.optionValues);
  const existingKey = await variantRepository.findOne({ where: { variantKey }, skipThrowError: true });
  if (existingKey) {
    throw new ConflictError("A variant with this exact option combination already exists");
  }

  // The store default applies only when the caller did not choose. Read once, here, and stored on the variant.
  const backorderPolicy = input.backorderPolicy ?? (await getSingletonSettings(inventorySettingsRepository)).defaultInventoryPolicy;

  return withTransaction(async (tx) => {
    // Re-checked inside the transaction: the product's axes may have changed since the read above,
    // and a conflicting axis update makes this transaction retry with the product as it now is.
    const current = await productRepository.findOne({ where: { _id: input.productId }, skipThrowError: true });
    if (!current) throw new NotFoundError("Product not found");
    assertOptionValuesMatchAxes(current.optionAxes, input.optionValues);

    const variant = await variantRepository.save(
      {
        productId: input.productId,
        sku: input.sku,
        variantKey,
        optionValues: input.optionValues,
        price: input.price,
        compareAtPrice: input.compareAtPrice,
        stock: input.stock,
        lowStockThreshold: input.lowStockThreshold,
        weight: input.weight,
        length: input.length,
        width: input.width,
        height: input.height,
        unitOfMeasure: input.unitOfMeasure ?? "EACH",
        unitsPerSale: input.unitsPerSale ?? 1,
        costPrice: input.costPrice,
        galleryOverride: input.galleryOverride ?? [],
        backorderPolicy,
      }
    );

    // The opening count is stock arriving, so it is recorded like any other receipt: the Adjustments log
    // then adds up to `stock` from the variant's first day.
    if (input.stock > 0) {
      await stockMovementRepository.save({
        variantId: variant._id,
        delta: input.stock,
        reason: "RECEIPT",
        actorId: input.actorId ? new mongoose.Types.ObjectId(input.actorId) : undefined,
        note: "Opening stock",
        at: new Date(),
      });
    }

    await maintainProductListingRollup(product._id);

    return tx.complete(variant);
  });
}
