import {
  MongoField,
  MongoSchema,
  Relation,
  Unique,
  localizedStringField,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Review — staff-moderated, with rating.
 *
 * Per scope decisions: included in v1.
 * Whether reviews require verified purchase is a business call (flagged in decisions doc).
 *
 * **One review per customer per product, editable rather than duplicated**
 * (MDS §15) — the same compound-invariant technique `Wishlist.customerProductKey`
 * already uses in this repo, forced by the same constraint: `@Unique()`
 * builds single-field indexes only. Without this key, "does this customer
 * already have a review for this product" was a check-then-write race —
 * two concurrent submissions could both pass the check and both insert.
 */
@MongoSchema({ timestamps: true })
export class ReviewSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => ProductSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Product" })
  productId!: mongoose.Types.ObjectId;

  @Relation(() => CustomerSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Customer" })
  customerId!: mongoose.Types.ObjectId;

  /** `<customerId>|<productId>` — see class doc comment. Computed and set by the application layer at creation, the same convention `Wishlist.customerProductKey` follows. */
  @Unique()
  @MongoField({ type: String, required: true })
  customerProductKey!: string;

  @Relation(() => OrderSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "Order" })
  orderId?: mongoose.Types.ObjectId;

  @MongoField({ type: Number, required: true, min: 1, max: 5 })
  rating!: number;

  @MongoField(localizedStringField())
  title!: LocalizedString;

  @MongoField(localizedStringField())
  body!: LocalizedString;

  @MongoField({ type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" })
  status!: "PENDING" | "APPROVED" | "REJECTED";

  @MongoField({ type: Boolean, default: false })
  verifiedPurchase!: boolean;

  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "StaffUser" })
  moderatedBy?: mongoose.Types.ObjectId;

  @MongoField({ type: Date, required: false })
  moderatedAt?: Date;
}

// Forward declarations
class ProductSchema {
  _id!: mongoose.Types.ObjectId;
}
class CustomerSchema {
  _id!: mongoose.Types.ObjectId;
}
class OrderSchema {
  _id!: mongoose.Types.ObjectId;
}

export const ReviewModel = createMongoModel("Review", ReviewSchema);

/** The canonical `customerProductKey` form — the one place it is computed, so every writer agrees on the format. */
export function buildReviewKey(customerId: mongoose.Types.ObjectId | string, productId: mongoose.Types.ObjectId | string): string {
  return `${customerId.toString()}|${productId.toString()}`;
}
