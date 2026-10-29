import { MongoField, MongoSchema, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * The counter `allocateOrderNumber` (Phase 3's order-number engine) increments
 * atomically. A single fixed-key document — unlike the restaurant precedent's
 * per-service-day counters — because nothing in this domain partitions order
 * numbers by date: MDS §8.4 describes `Order.orderNumber` as `(@Unique,
 * sequence)`, with no date component, and there is no `serviceDate` concept
 * here at all (the store has no delivery/pickup slots to schedule against).
 *
 * The `@Unique()` index on `key` is what makes the `$inc` upsert atomic under
 * concurrent placement — see `ensure-indexes.ts`'s doc comment on why nothing
 * waits for it to build except a boot-time assertion.
 */
@MongoSchema({ timestamps: true })
export class OrderSequenceSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true })
  key!: string;

  @MongoField({ type: Number, required: true, default: 0 })
  value!: number;
}

export const OrderSequenceModel = createMongoModel("OrderSequence", OrderSequenceSchema);
