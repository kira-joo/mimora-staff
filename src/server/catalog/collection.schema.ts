import {
  MongoField,
  MongoSchema,
  Unique,
  localizedStringField,
  imageAssetField,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Flat many-to-many collection for merchandising.
 *
 * Distinct from Category (hierarchical navigation). Per D-6: both concepts exist.
 * Examples: "Sale", "New Arrivals", "Summer Picks".
 */
@MongoSchema({ timestamps: true })
export class CollectionSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField(localizedStringField())
  name!: LocalizedString;

  @MongoField(localizedStringField())
  description!: LocalizedString;

  @Unique()
  @MongoField({ type: String, required: true, trim: true })
  slug!: string;

  @MongoField({ type: Number, default: 0 })
  sortOrder!: number;

  @MongoField(imageAssetField())
  image?: ImageAsset;

  @MongoField(localizedStringField())
  seoTitle!: LocalizedString;

  @MongoField(localizedStringField())
  seoDescription!: LocalizedString;

  @MongoField({ type: Boolean, default: false })
  published!: boolean;
}

export const CollectionModel = createMongoModel("Collection", CollectionSchema);
