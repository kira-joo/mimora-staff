import { MongoField, MongoSchema, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * The counter `allocateReturnNumber` increments atomically — a dedicated
 * model, not `OrderSequenceModel` with a different `key`, so `returnNumber`
 * allocation is never coupled to the order-number collection's name or
 * lifecycle. Same single-fixed-key-document shape as `OrderSequenceSchema`
 * for the identical reason: nothing in this domain partitions return
 * numbers by date or any other axis.
 *
 * The `@Unique()` index on `key` is what makes the `$inc` upsert atomic
 * under concurrent return requests — see `ensure-indexes.ts`'s doc comment
 * on why nothing waits for it to build except a boot-time assertion.
 */
@MongoSchema({ timestamps: true })
export class ReturnSequenceSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true })
  key!: string;

  @MongoField({ type: Number, required: true, default: 0 })
  value!: number;
}

export const ReturnSequenceModel = createMongoModel("ReturnSequence", ReturnSequenceSchema);
