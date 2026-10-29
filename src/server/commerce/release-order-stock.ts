import { ConflictError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { orderLineRepository, variantRepository } from "../core/repositories";
import { aggregateReservations, releaseStock } from "../engines/order-placement/reserve-stock";
import { maintainProductListingRollup } from "../catalog/rollups/maintain-product-listing";

/**
 * Puts back the stock an order was holding — through the existing
 * `releaseStock` (which writes the attributable stock movement), then keeps the
 * affected products' listing rollups honest. The ONE implementation behind
 * every cancellation: a customer's own cancel, a staff transition to CANCELLED,
 * and the unpaid-order expiry sweep.
 *
 * Must run inside the caller's transaction, after the status write — the stock,
 * the movement and the rollup are then rolled back with it. Callers decide
 * whether the transition releases stock (`releasesStock`); this only does it.
 */
export async function releaseOrderStock(orderId: mongoose.Types.ObjectId, context: { actorId?: mongoose.Types.ObjectId; at: Date }): Promise<void> {
  const lines = await orderLineRepository.findAll({ where: { orderId } });
  const variants = await variantRepository.findByIds(lines.map((line) => line.variantId.toString()));
  const variantById = new Map(variants.map((variant) => [variant._id.toString(), variant]));

  const reservations = aggregateReservations(
    lines.map((line) => {
      const variant = variantById.get(line.variantId.toString());
      if (!variant) throw new ConflictError(`Variant ${line.variantId} no longer exists.`);
      return { variantId: line.variantId, quantity: line.quantity, backorderPolicy: variant.backorderPolicy };
    })
  );

  await releaseStock(reservations, { orderId, actorId: context.actorId, at: context.at });

  const affectedProductIds = [...new Set(reservations.map((reservation) => variantById.get(reservation.variantId.toString())!.productId.toString()))].map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  for (const productId of affectedProductIds) {
    await maintainProductListingRollup(productId);
  }
}
