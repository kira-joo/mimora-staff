import {
  MongoField,
  MongoSchema,
  localizedStringField,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Size guide — reusable content entity, not a variant attribute.
 *
 * Per scope decisions: included in v1 (apparel returns driver).
 */
@MongoSchema({ timestamps: true })
export class SizeGuideSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField(localizedStringField())
  name!: LocalizedString;

  @MongoField(localizedStringField())
  description!: LocalizedString;

  /**
   * Size chart data — stored as structured JSON.
   * Example: {headers: ["Size", "Chest", "Waist"], rows: [["S", "34-36", "28-30"], ...]}
   */
  @MongoField({ type: mongoose.Schema.Types.Mixed, required: true })
  chartData!: Record<string, unknown>;
}

export const SizeGuideModel = createMongoModel("SizeGuide", SizeGuideSchema);
