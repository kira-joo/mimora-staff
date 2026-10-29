import { MongoField, MongoSchema, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * The one document every change to "who is an Owner" serialises on (`withOwnerGuard`).
 *
 * A staff demotion and a role edit each read "is another active Owner left?" and then write somewhere else. Under
 * MongoDB's snapshot isolation two such transactions that write DIFFERENT documents never conflict, so both read the
 * same pre-state, both pass, and the store is left with none (write skew). Making every such transaction first write
 * THIS document turns that into a write conflict: the loser retries after the winner commits and re-counts.
 *
 * The write must always change the document (`$inc`), because an update that sets a value the document already holds
 * is a no-op to MongoDB, takes no write lock and serialises nothing — measured for the `bootstrap-owner` script, which
 * uses the same technique on its own document.
 */
@MongoSchema({ timestamps: true })
export class StaffOwnerLockSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true })
  key!: string;

  @MongoField({ type: Number, required: true, default: 0 })
  version!: number;
}

export const StaffOwnerLockModel = createMongoModel("StaffOwnerLock", StaffOwnerLockSchema);
