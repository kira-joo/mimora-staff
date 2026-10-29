import { ConflictError, NotFoundError } from "@kira-joo/backend-toolkit-core";
import { withTransaction } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";
import { orderLineRepository, returnLineRepository, returnRepository, variantRepository } from "../../core/repositories";
import { appendOrderTimelineEntry } from "../../commerce/order-timeline";
import { allLinesReceived, assertInspectedCondition, assertReturnTransition } from "../../engines/returns/return-eligibility";
import { applyStockMovement } from "../../engines/inventory/apply-stock-movement";
import { maintainProductListingRollup } from "../../catalog/rollups/maintain-product-listing";

export interface ReceiveReturnLineInput {
  returnLineId: string;
  disposition: "RESTOCK" | "DISCARD";
  /** What staff found on inspection — mandatory, recorded beside the disposition. */
  inspectedCondition: string;
}

export interface ReceiveReturnInput {
  returnId: string;
  lines: ReceiveReturnLineInput[];
  staffId: string;
  now: Date;
}

/**
 * Records the physical inspection outcome for a received return, per line:
 * the staff decision (`disposition`) and what was actually found
 * (`inspectedCondition`, mandatory). Only a `RESTOCK` disposition moves stock —
 * `StockMovementSchema`'s own doc comment names this exact case ("return
 * receive with restocking") as half the reason that schema exists.
 *
 * Once every line of the return carries a disposition, the return itself moves
 * APPROVED → RECEIVED in the same transaction (a partial receipt leaves it
 * APPROVED, so the remaining lines can still be received); a refund is then
 * allowed from RECEIVED. A line that already carries a disposition cannot be
 * received again — receiving is a one-time physical event, and re-receiving
 * would double the stock movement for a `RESTOCK` line.
 */
export async function receiveReturn(input: ReceiveReturnInput) {
  const { returnId, lines, staffId, now } = input;

  const ret = await returnRepository.findOne({ where: { _id: returnId } });
  if (ret.status !== "APPROVED") {
    throw new ConflictError(`Cannot receive a return with status ${ret.status} — only an APPROVED return can be received`);
  }

  const returnLines = await returnLineRepository.findAll({
    where: { returnId: ret._id, _id: { $in: lines.map((l) => l.returnLineId) } },
  });
  const returnLineById = new Map(returnLines.map((line) => [line._id.toString(), line]));

  for (const line of lines) {
    assertInspectedCondition(line.inspectedCondition);
    const returnLine = returnLineById.get(line.returnLineId);
    if (!returnLine) {
      throw new NotFoundError(`Return line ${line.returnLineId} does not belong to this return`);
    }
    if (returnLine.disposition) {
      throw new ConflictError(`Return line ${line.returnLineId} was already received`);
    }
  }

  const orderLines = await orderLineRepository.findByIds(returnLines.map((l) => l.orderLineId.toString()));
  const orderLineById = new Map(orderLines.map((line) => [line._id.toString(), line]));

  return withTransaction(async (tx) => {
    const affectedProductIds = new Set<string>();

    for (const line of lines) {
      const returnLine = returnLineById.get(line.returnLineId)!;

      await returnLineRepository.update(
        { where: { _id: returnLine._id } },
        { disposition: line.disposition, inspectedCondition: line.inspectedCondition.trim() }
      );

      if (line.disposition === "RESTOCK") {
        const orderLine = orderLineById.get(returnLine.orderLineId.toString());
        if (!orderLine) {
          throw new NotFoundError(`Order line ${returnLine.orderLineId} no longer exists`);
        }

        await applyStockMovement({
          variantId: orderLine.variantId,
          delta: returnLine.quantity,
          reason: "RETURN",
          actorId: new mongoose.Types.ObjectId(staffId),
          orderId: ret.orderId,
        });

        const variant = await variantRepository.findOne({ where: { _id: orderLine.variantId }, skipThrowError: true });
        if (variant) affectedProductIds.add(variant.productId.toString());
      }
    }

    for (const productId of affectedProductIds) {
      await maintainProductListingRollup(new mongoose.Types.ObjectId(productId));
    }

    await appendOrderTimelineEntry(ret.orderId, {
      type: "RETURN_RECEIVED",
      at: now,
      actorType: "STAFF",
      actorId: new mongoose.Types.ObjectId(staffId),
    });

    const updatedLines = await returnLineRepository.findAll({ where: { returnId: ret._id } });

    if (allLinesReceived(updatedLines)) {
      assertReturnTransition(ret.status, "RECEIVED");
      await returnRepository.updateAtomic({ _id: ret._id, status: ret.status }, { $set: { status: "RECEIVED", processedAt: now, processedBy: staffId } });
    }

    return tx.complete(updatedLines);
  });
}
