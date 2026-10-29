import { MongoField, MongoSchema, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * OperatingHours — new in Phase 4A.5 (MDS §8.5).
 *
 * `pickup-location.schema.ts`'s own doc comment already named this as an
 * explicitly deferred entity ("the full `OperatingHours` entity... is its
 * own MDS §8.5 entity and a materially larger feature than the pickup
 * on/off switch that correction restores") — this is that entity, built
 * now rather than deferred again.
 *
 * `weekday` is `0`–`6` (Sunday–Saturday), matching `Date.getDay()` so a
 * caller never has to translate between two weekday numbering schemes.
 * `exceptions[]` overrides the weekly schedule for a specific date — a
 * public holiday or a one-off closure — and takes precedence when present.
 *
 * Singleton per deployment, same convention as `StoreProfile`.
 */
@MongoSchema({ timestamps: true })
export class OperatingHoursSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField({
    type: [
      new mongoose.Schema(
        {
          weekday: { type: Number, required: true, min: 0, max: 6 },
          ranges: {
            type: [new mongoose.Schema({ open: { type: String, required: true }, close: { type: String, required: true } }, { _id: false })],
            default: () => [],
          },
        },
        { _id: false }
      ),
    ],
    default: () => [],
  })
  weekly!: Array<{ weekday: number; ranges: Array<{ open: string; close: string }> }>;

  @MongoField({
    type: [
      new mongoose.Schema(
        {
          date: { type: Date, required: true },
          closed: { type: Boolean, required: true, default: true },
          ranges: {
            type: [new mongoose.Schema({ open: { type: String, required: true }, close: { type: String, required: true } }, { _id: false })],
            default: () => [],
          },
        },
        { _id: false }
      ),
    ],
    default: () => [],
  })
  exceptions!: Array<{ date: Date; closed: boolean; ranges: Array<{ open: string; close: string }> }>;
}

export const OperatingHoursModel = createMongoModel("OperatingHours", OperatingHoursSchema);
