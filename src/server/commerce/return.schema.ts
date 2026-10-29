import {
  MongoField,
  MongoSchema,
  Relation,
  moneyField,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import type { Money } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Return — tied to immutable order-line snapshots.
 *
 * Per D-12: v1 records and audits only, with mandatory reference field.
 * No pretence of automation — a COD/wallet refund is human-executed.
 */
@MongoSchema({ timestamps: true })
export class ReturnSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => OrderSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Order" })
  orderId!: mongoose.Types.ObjectId;

  @Relation(() => CustomerSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "Customer" })
  customerId?: mongoose.Types.ObjectId;

  @MongoField({ type: String, required: true })
  returnNumber!: string;

  @MongoField({ type: String, required: true })
  reason!: string;

  @MongoField({ type: String, enum: ["REQUESTED", "APPROVED", "RECEIVED", "REJECTED", "REFUNDED"], default: "REQUESTED" })
  status!: "REQUESTED" | "APPROVED" | "RECEIVED" | "REJECTED" | "REFUNDED";

  @MongoField({ type: Date, required: true })
  requestedAt!: Date;

  @MongoField({ type: Date, required: false })
  processedAt?: Date;

  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "StaffUser" })
  processedBy?: mongoose.Types.ObjectId;

  /**
   * Mandatory reference for audit — no automated refund execution.
   */
  @MongoField({ type: String, required: false })
  refundReference?: string;

  @MongoField(moneyField())
  refundAmount?: Money;

  @MongoField({ type: String, required: false })
  notes?: string;
}

// Forward declarations
class OrderSchema {
  _id!: mongoose.Types.ObjectId;
}
class CustomerSchema {
  _id!: mongoose.Types.ObjectId;
}

export const ReturnModel = createMongoModel("Return", ReturnSchema);

/**
 * Return line — at variant granularity, tied to order line snapshot.
 *
 * `condition` and `disposition` are distinct on purpose (corrective fix — the
 * original v1 of this schema had only a free-text `condition` and no
 * `disposition` at all). `condition` describes the item's observed state
 * ("unopened", "damaged"); `disposition` is the staff decision that follows
 * from it (restock the unit, or discard it) and is what inventory actually
 * acts on. Per MDS §8.4 `ReturnLine.disposition (RESTOCK | DISCARD)`.
 */
@MongoSchema({ timestamps: true })
export class ReturnLineSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => ReturnSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Return" })
  returnId!: mongoose.Types.ObjectId;

  @Relation(() => OrderLineSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "OrderLine" })
  orderLineId!: mongoose.Types.ObjectId;

  @MongoField({ type: Number, required: true, min: 1 })
  quantity!: number;

  /**
   * Per-line reason. `Return.reason` above is the overall reason logged at
   * request time; a multi-item return may have lines returned for different
   * reasons.
   */
  @MongoField({ type: String, required: true })
  reason!: string;

  @MongoField({ type: String, required: true })
  condition!: string;

  /**
   * What staff actually found when the goods arrived — recorded at receipt,
   * beside `disposition`. `condition` above is the customer's own claim at
   * request time; this is the inspection, and the two can disagree (that is
   * the point of recording both). Absent until the line is received.
   */
  @MongoField({ type: String, required: false })
  inspectedCondition?: string;

  /**
   * The staff decision, made during processing — absent until then, same as
   * `Return.processedAt`/`processedBy`.
   */
  @MongoField({ type: String, enum: ["RESTOCK", "DISCARD"], required: false })
  disposition?: "RESTOCK" | "DISCARD";
}

// Forward declaration
class OrderLineSchema {
  _id!: mongoose.Types.ObjectId;
}

export const ReturnLineModel = createMongoModel("ReturnLine", ReturnLineSchema);
