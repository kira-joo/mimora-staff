import { MongoField, MongoSchema, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * InventorySettings — new in Phase 4A.5 (MDS §8.1).
 *
 * MDS lists `allowNegativeStock: false` on this entity, "not configurable
 * to true." Deliberately **not** a schema field here: there is nothing to
 * persist for a value that can never vary, and a stored field a merchant
 * can query but never change invites the question "why is this here."
 * Negative stock is instead structurally impossible — `reserve-stock.ts`'s
 * atomic `findOneAndUpdate({stock: {$gte: quantity}}, {$inc: {stock: -quantity}})`
 * guard is the actual enforcement, and `CONTINUE_SELLING`
 * (`Variant.backorderPolicy`) is the one deliberate override, which skips
 * the stock check entirely rather than letting stock go negative.
 *
 * Singleton per deployment, same convention as `StoreProfile`.
 */
@MongoSchema({ timestamps: true })
export class InventorySettingsSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField({ type: Number, required: true, default: 5 })
  lowStockThreshold!: number;

  @MongoField({ type: String, enum: ["DENY", "CONTINUE_SELLING"], default: "DENY" })
  defaultInventoryPolicy!: "DENY" | "CONTINUE_SELLING";
}

export const InventorySettingsModel = createMongoModel("InventorySettings", InventorySettingsSchema);
