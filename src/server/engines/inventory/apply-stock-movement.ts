import { ConflictError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { stockMovementRepository, variantRepository } from "../../core/repositories";
import { notifyStockChange } from "../../notifications/low-stock";

export interface ApplyStockMovementInput {
  variantId: mongoose.Types.ObjectId;
  /** Positive for stock added (RECEIPT, RETURN restock), negative for stock removed (ADJUSTMENT down, DAMAGE). */
  delta: number;
  reason: "RETURN" | "ADJUSTMENT" | "RECEIPT" | "DAMAGE";
  actorId: mongoose.Types.ObjectId;
  orderId?: mongoose.Types.ObjectId;
  note?: string;
  at?: Date;
  /**
   * When `true` and `delta` is negative, the decrement is guarded by
   * `stock: { $gte: -delta }` inside the update filter — the same
   * predicate-in-the-filter shape `reserve-stock.ts` uses, so two
   * concurrent negative adjustments can't both succeed past zero.
   * `InventorySettings`' own doc comment calls negative stock
   * "structurally impossible"; RETURN restock (always positive) never
   * needs this, so it isn't the default.
   */
  guardNonNegative?: boolean;
}

/**
 * Applies a stock change and records its audit row in one call —
 * `StockMovementModel` (per its own doc comment) exists precisely so
 * "admin inventory adjust/bulk-adjust" and "return receive with
 * restocking" never mutate `Variant.stock` without a matching movement.
 *
 * `SALE` is deliberately not in this function's reason union — that
 * movement belongs to `reserve-stock.ts`'s order-placement path, which
 * writes it itself (`recordSaleMovements`, and `releaseStock` for the
 * cancellation that reverses it) in the placement/cancel transaction.
 *
 * Does not maintain the product listing rollup — same division of
 * responsibility as `reserveStock`/`releaseStock`: the caller, which
 * knows which product(s) are affected and whether it's already inside a
 * loop of several, calls `maintainProductListingRollup` itself.
 */
export async function applyStockMovement(input: ApplyStockMovementInput): Promise<void> {
  const filter: Record<string, unknown> = { _id: input.variantId };
  if (input.guardNonNegative && input.delta < 0) {
    filter.stock = { $gte: -input.delta };
  }

  const updated = await variantRepository.updateAtomic(filter, { $inc: { stock: input.delta } }, { skipThrowError: true });
  if (!updated) {
    throw new ConflictError("This adjustment would take stock below zero.");
  }

  await stockMovementRepository.save({
    variantId: input.variantId,
    delta: input.delta,
    reason: input.reason,
    orderId: input.orderId,
    actorId: input.actorId,
    note: input.note,
    at: input.at ?? new Date(),
  });

  // Staff are told when stock crosses into "low" — after commit when this runs in a transaction; never fails the movement.
  await notifyStockChange({ variantId: input.variantId, before: updated.stock - input.delta, after: updated.stock });
}
