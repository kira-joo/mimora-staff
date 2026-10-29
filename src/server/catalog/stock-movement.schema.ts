import { MongoField, MongoSchema, Relation, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * StockMovement — the audit trail for every change to a variant's stock,
 * per MDS §8.3. New in this pass (Phase 4A.5's own checklist did not list
 * it; the Phase 4B verification pass found it genuinely missing and
 * required by the canonical route inventory — admin inventory
 * adjust/bulk-adjust, return receive with restocking).
 *
 * `Variant.stock` remains the authoritative live figure (unchanged);
 * movements are the audit trail, never the source of truth themselves —
 * confirmed against MDS §8.3's own framing ("`stock` means sellable
 * on-hand units... movements are the audit trail").
 *
 * Returns, damage and receiving each record their own movement rather than
 * all mutating one counter with incompatible semantics — `reason`
 * distinguishes them.
 */
@MongoSchema({ timestamps: true })
export class StockMovementSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => VariantSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Variant" })
  variantId!: mongoose.Types.ObjectId;

  /** Signed — positive for stock added (RECEIPT, RETURN restock, a cancelled order's released stock), negative for stock removed (SALE, DAMAGE, a downward ADJUSTMENT). */
  @MongoField({ type: Number, required: true })
  delta!: number;

  @MongoField({ type: String, enum: ["SALE", "RETURN", "ADJUSTMENT", "RECEIPT", "DAMAGE"], required: true })
  reason!: "SALE" | "RETURN" | "ADJUSTMENT" | "RECEIPT" | "DAMAGE";

  /** Present for SALE/RETURN movements — the order this stock change is tied to. Absent for a standalone ADJUSTMENT/RECEIPT/DAMAGE. */
  @Relation(() => OrderSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "Order" })
  orderId?: mongoose.Types.ObjectId;

  /**
   * Who caused the change: the staff member for an adjustment, receipt or
   * damage; the customer for a sale or a customer cancellation. Absent for a
   * guest's sale — a guest has no identity to record, and a made-up one would be
   * a lie in an audit trail.
   */
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false })
  actorId?: mongoose.Types.ObjectId;

  @MongoField({ type: String, required: false })
  note?: string;

  /** The movement's effective instant — distinct from `createdAt` (record-creation time), per MDS §8.3 listing it as its own field; a backfilled or batch-reconciled movement may record stock changing at a different moment than the row was written. */
  @MongoField({ type: Date, required: true, default: () => new Date() })
  at!: Date;
}

// Forward declarations
class VariantSchema {
  _id!: mongoose.Types.ObjectId;
}
class OrderSchema {
  _id!: mongoose.Types.ObjectId;
}

export const StockMovementModel = createMongoModel("StockMovement", StockMovementSchema);
