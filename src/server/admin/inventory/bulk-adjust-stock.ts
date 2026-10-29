import { NotFoundError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { variantRepository } from "../../core/repositories";
import { applyStockMovement } from "../../engines/inventory/apply-stock-movement";
import { maintainProductListingRollup } from "../../catalog/rollups/maintain-product-listing";

export interface BulkAdjustStockItemInput {
  variantId: string;
  delta: number;
  reason: "ADJUSTMENT" | "RECEIPT" | "DAMAGE";
  note?: string;
}

export interface BulkAdjustStockInput {
  items: BulkAdjustStockItemInput[];
  staffId: string;
  now: Date;
}

/**
 * Sequential within one transaction, sorted into canonical variant-id
 * order — same defensive shape as `reserve-stock.ts`: one session cannot
 * run concurrent operations, and processing two overlapping bulk
 * adjustments in a different order is exactly what creates avoidable
 * deadlock pressure.
 */
export async function bulkAdjustStock(input: BulkAdjustStockInput) {
  const { staffId, now } = input;
  const items = [...input.items].sort((a, b) => a.variantId.localeCompare(b.variantId));

  const variants = await variantRepository.findAll({ where: { _id: { $in: items.map((i) => i.variantId) } } });
  const variantById = new Map(variants.map((v) => [v._id.toString(), v]));

  for (const item of items) {
    if (!variantById.has(item.variantId)) {
      throw new NotFoundError(`Variant ${item.variantId} not found`);
    }
  }

  return withTransaction(async (tx) => {
    const affectedProductIds = new Set<string>();

    for (const item of items) {
      const variant = variantById.get(item.variantId)!;

      await applyStockMovement({
        variantId: variant._id,
        delta: item.delta,
        reason: item.reason,
        actorId: new mongoose.Types.ObjectId(staffId),
        note: item.note,
        at: now,
        guardNonNegative: true,
      });

      affectedProductIds.add(variant.productId.toString());
    }

    for (const productId of affectedProductIds) {
      await maintainProductListingRollup(new mongoose.Types.ObjectId(productId));
    }

    const updated = await variantRepository.findAll({ where: { _id: { $in: items.map((i) => i.variantId) } } });
    return tx.complete(updated);
  });
}
