import { MongoField, MongoSchema, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * The counter `allocateInvoiceNumber` increments atomically — a dedicated model, like `ReturnSequenceSchema`, so
 * invoice numbering is never coupled to the order-number collection: the two sequences are independent (an order
 * placed before invoices existed has no invoice number, so `INV-000001` and `ORD-000001` are unrelated), and
 * resetting one in a test or a migration can never touch the other.
 *
 * The `@Unique()` index on `key` is what makes the `$inc` upsert atomic under concurrent placement.
 */
@MongoSchema({ timestamps: true })
export class InvoiceSequenceSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true })
  key!: string;

  @MongoField({ type: Number, required: true, default: 0 })
  value!: number;
}

export const InvoiceSequenceModel = createMongoModel("InvoiceSequence", InvoiceSequenceSchema);
