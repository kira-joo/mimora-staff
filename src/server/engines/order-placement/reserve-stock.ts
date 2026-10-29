import { ConflictError } from "@kira-joo/backend-toolkit-core";
import mongoose from "mongoose";
import { stockMovementRepository, variantRepository } from "../../core/repositories";

export interface StockReservation {
  variantId: mongoose.Types.ObjectId;
  quantity: number;
  backorderPolicy: "DENY" | "CONTINUE_SELLING";
}

/**
 * Decrements each variant's stock atomically, or throws.
 *
 * **The quantity predicate goes inside the `findOneAndUpdate` filter** — a
 * read-then-write is not a guard, because two concurrent reads can both see
 * "1 left" and both proceed to write. Putting `stock: { $gte: quantity }` in
 * the filter makes the check and the decrement one indivisible operation: the
 * second of two concurrent callers targeting the last unit simply fails to
 * match, rather than racing the first to a negative count.
 *
 * `CONTINUE_SELLING` variants skip the quantity predicate entirely — that is
 * the whole meaning of the policy, letting a merchant oversell deliberately on
 * a pre-order item. `DENY` (the default) enforces it.
 *
 * **Sequential, not parallel.** One session cannot run concurrent operations,
 * so the caller must aggregate duplicate variants into one reservation per
 * variant and sort them into a canonical order before calling this — done
 * here defensively too (`Array.sort` by variant id string) in case a caller
 * forgets, since decrementing the same two variants in a different order
 * across two concurrent orders is exactly what creates avoidable deadlock
 * pressure.
 *
 * Returns the variants this reservation sold out (see `ReservationOutcome`).
 */
export async function reserveStock(reservations: StockReservation[]): Promise<ReservationOutcome> {
  const soldOut: mongoose.Types.ObjectId[] = [];
  if (reservations.length === 0) return { soldOut };

  const ordered = [...reservations].sort((a, b) => a.variantId.toString().localeCompare(b.variantId.toString()));

  for (const reservation of ordered) {
    const filter: Record<string, unknown> = { _id: reservation.variantId };
    if (reservation.backorderPolicy === "DENY") {
      filter.stock = { $gte: reservation.quantity };
    }

    // The `stock >= quantity` predicate lives in `filter`, so a miss means "not enough stock".
    const updated = await variantRepository.updateAtomic(filter, { $inc: { stock: -reservation.quantity } }, { skipThrowError: true });

    if (!updated) {
      throw new ConflictError("One of the items in this order is no longer available in the quantity requested.");
    }
    // A DENY variant matched only with stock >= quantity >= 1, so it was purchasable before; it stops
    // being purchasable exactly when this decrement takes it to zero. CONTINUE_SELLING never flips.
    if (reservation.backorderPolicy === "DENY" && updated.stock <= 0) soldOut.push(reservation.variantId);
  }
  return { soldOut };
}

/**
 * Which reserved variants this reservation took from purchasable to sold out. That is the ONLY way an
 * order can change a product's listing rollup — prices, images and the discontinued flag are not
 * touched by an order — so the caller recomputes the rollup for those products alone, instead of
 * writing every ordered product's document on every order (each write is a transaction-level hot
 * spot: concurrent orders of one product conflicted on it and exhausted the retry budget as a 503).
 */
export interface ReservationOutcome {
  soldOut: mongoose.Types.ObjectId[];
}

/**
 * Who and what a stock movement belongs to — the audit attribution
 * `StockMovement` records. Every field is optional: a guest's sale has no actor,
 * and a caller that predates this parameter still gets its movement written.
 */
export interface MovementContext {
  /** The order the stock change belongs to. */
  orderId?: mongoose.Types.ObjectId;
  /** The customer or staff member behind it. Absent for a guest checkout. */
  actorId?: mongoose.Types.ObjectId;
  /** The movement's effective instant; defaults to now. */
  at?: Date;
  note?: string;
}

/**
 * Writes the SALE movement for each variant `reserveStock` decremented — one
 * row per variant, `delta = -quantity`, in the SAME transaction as the
 * decrement, so a rolled-back placement leaves no movement behind.
 *
 * Separate from `reserveStock` because a movement points at the order, and the
 * order document does not exist until after the stock is taken (the stock guard
 * is what decides whether there is an order at all).
 */
export async function recordSaleMovements(reservations: StockReservation[], context: MovementContext): Promise<void> {
  if (reservations.length === 0) return;
  const ordered = [...reservations].sort((a, b) => a.variantId.toString().localeCompare(b.variantId.toString()));
  const at = context.at ?? new Date();

  for (const reservation of ordered) {
    await stockMovementRepository.save({
      variantId: reservation.variantId,
      delta: -reservation.quantity,
      reason: "SALE",
      orderId: context.orderId,
      actorId: context.actorId,
      note: context.note,
      at,
    });
  }
}

/**
 * The inverse of `reserveStock`, for an order cancelled anywhere along its
 * holding states (`order-state-machine.releasesStock`). No quantity guard is
 * needed on the way back in — restoring stock can never oversell.
 *
 * Each restored variant also gets a `RETURN` movement (`delta = +quantity`):
 * `StockMovement` has no separate release type, and units coming back from a
 * cancelled order are the same event as units coming back from a return — the
 * `note` says which. Without the row the sale movement written at placement
 * would never be reversed and the log would stop adding up to `Variant.stock`.
 * Written in the caller's transaction, after the increment, like the decrement.
 *
 * `context` is optional only so existing callers keep compiling; every caller
 * should pass at least `orderId` and `actorId` so the row is attributable.
 */
export async function releaseStock(reservations: StockReservation[], context: MovementContext = {}): Promise<void> {
  if (reservations.length === 0) return;

  const ordered = [...reservations].sort((a, b) => a.variantId.toString().localeCompare(b.variantId.toString()));
  const at = context.at ?? new Date();

  for (const reservation of ordered) {
    await variantRepository.updateAtomic({ _id: reservation.variantId }, { $inc: { stock: reservation.quantity } }, { skipThrowError: true });
    await stockMovementRepository.save({
      variantId: reservation.variantId,
      delta: reservation.quantity,
      reason: "RETURN",
      orderId: context.orderId,
      actorId: context.actorId,
      note: context.note ?? "Order cancelled: reserved stock released",
      at,
    });
  }
}

/**
 * Aggregates duplicate variants in one order into a single reservation per
 * variant. A cart with two lines referencing the same variant (unusual, since
 * cart lines normally merge on `variantId`, but not guaranteed by every
 * caller) must decrement once with the summed quantity, not twice — two
 * separate decrements on the same document within one session would be two
 * sequential operations racing nothing, but summing first is both fewer
 * round trips and the one shape `reserveStock`'s canonical-order guarantee
 * assumes.
 */
export function aggregateReservations(
  lines: { variantId: mongoose.Types.ObjectId; quantity: number; backorderPolicy: "DENY" | "CONTINUE_SELLING" }[]
): StockReservation[] {
  const byVariant = new Map<string, StockReservation>();

  for (const line of lines) {
    const key = line.variantId.toString();
    const existing = byVariant.get(key);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      byVariant.set(key, { variantId: line.variantId, quantity: line.quantity, backorderPolicy: line.backorderPolicy });
    }
  }

  return [...byVariant.values()];
}
