import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { variantRepository } from "../../core/repositories";
import { applyStockMovement } from "../../engines/inventory/apply-stock-movement";
import { maintainProductListingRollup } from "../../catalog/rollups/maintain-product-listing";

export interface AdjustStockInput {
  variantId: string;
  delta: number;
  reason: "ADJUSTMENT" | "RECEIPT" | "DAMAGE";
  note?: string;
  staffId: string;
  now: Date;
}

export async function adjustStock(input: AdjustStockInput) {
  const { variantId, delta, reason, note, staffId, now } = input;

  const variant = await variantRepository.findOne({ where: { _id: variantId } });

  return withTransaction(async (tx) => {
    await applyStockMovement({
      variantId: variant._id,
      delta,
      reason,
      actorId: new mongoose.Types.ObjectId(staffId),
      note,
      at: now,
      guardNonNegative: true,
    });

    await maintainProductListingRollup(variant.productId);

    const updated = await variantRepository.findOne({ where: { _id: variant._id } });
    return tx.complete(updated);
  });
}
