import { MongoField, MongoSchema, Relation, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * PaymentProof — submission HISTORY, new in Phase 4A.5.
 *
 * `Order.payment` holds CURRENT payment state; this collection holds every
 * submission attempt as its own row. Justified by MDS's own requirement
 * that "a rejected proof reopens submission with the staff reason shown" —
 * a single overwritable field (the shape `restaurant-platform-staff` uses,
 * `payment.proofAsset` as one `Mixed` field) loses the rejected image and
 * the rejection reason the moment a customer resubmits, which is exactly
 * the evidence a manual-verification business needs to keep for a dispute.
 *
 * `asset` intentionally does **not** use `imageAssetField()` /
 * `ImageAsset` — that type carries a `secureUrl`, a permanent public CDN
 * URL, which is exactly wrong for a bank receipt. Storing only
 * `{publicId, format, bytes, mimeType, filename}` (Cloudinary's `private`
 * delivery type via `createCloudinaryPrivateAssets`) means there is no URL
 * to leak through history, referrers, or a forwarded screenshot — retrieval
 * mints a short-lived signed URL per request, behind the same permission
 * check that guards the order (route layer, Phase 4B; this schema only
 * fixes the storage shape).
 */
@MongoSchema({ timestamps: true })
export class PaymentProofSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => OrderSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Order" })
  orderId!: mongoose.Types.ObjectId;

  @MongoField({ type: Date, required: true })
  submittedAt!: Date;

  @MongoField({
    type: new mongoose.Schema(
      {
        publicId: { type: String, required: true },
        format: { type: String, required: true },
        bytes: { type: Number, required: true },
        mimeType: { type: String, required: true },
        filename: { type: String, required: true },
      },
      { _id: false }
    ),
    required: true,
  })
  asset!: { publicId: string; format: string; bytes: number; mimeType: string; filename: string };

  @MongoField({ type: String, enum: ["SUBMITTED", "VERIFIED", "REJECTED"], default: "SUBMITTED" })
  status!: "SUBMITTED" | "VERIFIED" | "REJECTED";

  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false })
  reviewedBy?: mongoose.Types.ObjectId;

  @MongoField({ type: Date, required: false })
  reviewedAt?: Date;

  @MongoField({ type: String, required: false })
  rejectionReason?: string;
}

// Forward declaration
class OrderSchema {
  _id!: mongoose.Types.ObjectId;
}

export const PaymentProofModel = createMongoModel("PaymentProof", PaymentProofSchema);
