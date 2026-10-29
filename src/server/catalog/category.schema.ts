import {
  MongoField,
  MongoSchema,
  Unique,
  Relation,
  localizedStringField,
  imageAssetField,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, ImageAsset } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Hierarchical category for navigation and canonical URLs.
 *
 * Distinct from Collection (flat merchandising). Per D-6: both concepts exist.
 */
@MongoSchema({ timestamps: true })
export class CategorySchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField(localizedStringField())
  name!: LocalizedString;

  @MongoField(localizedStringField())
  description!: LocalizedString;

  @Unique()
  @MongoField({ type: String, required: true, trim: true })
  slug!: string;

  @Relation(() => CategorySchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "Category" })
  parentId?: mongoose.Types.ObjectId;

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

export const CategoryModel = createMongoModel("Category", CategorySchema);
