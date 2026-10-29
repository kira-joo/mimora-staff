import { toMoney } from "@kira-joo/toolkit-common";
import { createProduct } from "../products/create-product";
import { updateProduct } from "../products/update-product";
import { setProductLifecycle } from "../products/set-product-lifecycle";
import { createVariant } from "../variants/create-variant";
import { updateVariant, type UpdateVariantInput } from "../variants/update-variant";
import { adjustStock } from "../inventory/adjust-stock";
import type { CatalogImportPlan } from "./plan-catalog-import";

export interface ImportResult {
  products: { created: number; updated: number };
  variants: { created: number; updated: number };
  stockMovements: { receipts: number; adjustments: number };
}

/**
 * Applies a plan through the SAME services the console uses, so every rule they enforce — default-locale
 * completeness for a live product, axis-key immutability, SKU and `variantKey` uniqueness, the store's default
 * backorder policy, the RECEIPT "Opening stock" movement, the listing rollup — holds for an import without being
 * re-implemented here.
 *
 * MUST run inside the caller's `withTransaction`: every service below joins it, so a failure at any row leaves
 * nothing — not the first product, not a single movement. Sequential on purpose (one session, no concurrent work),
 * and no external I/O (cache invalidation is declared by the route and fires only after the commit).
 */
export async function applyCatalogImportPlan(plan: CatalogImportPlan, context: { actorId: string; now: Date; note: string }): Promise<ImportResult> {
  const result: ImportResult = { products: { created: 0, updated: 0 }, variants: { created: 0, updated: 0 }, stockMovements: { receipts: 0, adjustments: 0 } };

  for (const product of plan.products) {
    let productId: string;
    if (product.action === "create") {
      const created = await createProduct({
        name: product.name,
        description: product.description,
        slug: product.row.slug,
        categoryId: product.categoryId,
        brandId: product.brandId,
        optionAxes: product.optionAxes,
        attributes: product.attributes,
        lifecycle: product.lifecycle,
      });
      productId = created._id.toString();
      result.products.created += 1;
    } else {
      productId = product.existing!.id;
      await updateProduct(productId, {
        name: product.name,
        description: product.description,
        categoryId: product.categoryId,
        brandId: product.brandId,
        optionAxes: product.optionAxes,
        attributes: product.attributes,
      });
      if (product.lifecycle !== product.existing!.lifecycle) await setProductLifecycle(productId, product.lifecycle);
      result.products.updated += 1;
    }

    for (const planned of product.variants) {
      const row = planned.row;
      if (planned.action === "create") {
        const created = await createVariant({
          productId,
          sku: row.sku,
          optionValues: row.optionValues,
          price: toMoney(row.price),
          compareAtPrice: row.compareAtPrice ? toMoney(row.compareAtPrice) : undefined,
          costPrice: row.costPrice ? toMoney(row.costPrice) : undefined,
          stock: row.stock ?? 0,
          weight: row.weight,
          length: row.length,
          width: row.width,
          height: row.height,
          unitOfMeasure: row.unitOfMeasure,
          unitsPerSale: row.unitsPerSale,
          actorId: context.actorId,
        });
        if (row.active === false) await updateVariant(created._id.toString(), { discontinued: true });
        result.variants.created += 1;
        if ((row.stock ?? 0) > 0) result.stockMovements.receipts += 1;
        continue;
      }

      const patch: UpdateVariantInput = {
        ...(row.price !== undefined ? { price: toMoney(row.price) } : {}),
        ...(row.compareAtPrice !== undefined ? { compareAtPrice: toMoney(row.compareAtPrice) } : {}),
        ...(row.costPrice !== undefined ? { costPrice: toMoney(row.costPrice) } : {}),
        ...(row.weight !== undefined ? { weight: row.weight } : {}),
        ...(row.length !== undefined ? { length: row.length } : {}),
        ...(row.width !== undefined ? { width: row.width } : {}),
        ...(row.height !== undefined ? { height: row.height } : {}),
        ...(row.unitOfMeasure !== undefined ? { unitOfMeasure: row.unitOfMeasure } : {}),
        ...(row.unitsPerSale !== undefined ? { unitsPerSale: row.unitsPerSale } : {}),
        ...(row.active !== undefined ? { discontinued: !row.active } : {}),
      };
      if (Object.keys(patch).length > 0) await updateVariant(planned.existingId!, patch);
      if (planned.stockDelta !== undefined) {
        await adjustStock({ variantId: planned.existingId!, delta: planned.stockDelta, reason: "ADJUSTMENT", note: context.note, staffId: context.actorId, now: context.now });
        result.stockMovements.adjustments += 1;
      }
      result.variants.updated += 1;
    }
  }

  return result;
}
