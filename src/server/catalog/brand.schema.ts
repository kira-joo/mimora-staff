import {
  MongoField,
  MongoSchema,
  Unique,
  localizedStringField,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Brand entity — a facet and a landing page.
 *
 * Included in v1 per scope decisions: trivial now, awkward to retrofit into URLs later.
 */
@MongoSchema({ timestamps: true })
export class BrandSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField(localizedStringField())
  name!: LocalizedString;

  @Unique()
  @MongoField({ type: String, required: true, trim: true })
  slug!: string;

  @MongoField(localizedStringField())
  description!: LocalizedString;

  @MongoField({ type: Boolean, default: false })
  published!: boolean;
}

export const BrandModel = createMongoModel("Brand", BrandSchema);
