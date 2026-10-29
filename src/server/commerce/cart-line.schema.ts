import { MongoField, MongoSchema, Relation, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * A cart line — standalone collection, not embedded on `Cart`.
 *
 * Phase 4B Batch 3, converted from an embedded `Cart.lines[]` array after
 * a design-checkpoint review: `Order`/`OrderLine` already uses exactly
 * this shape in this same codebase (`OrderLineSchema.orderId` is the
 * identical forward `@Relation`), and the embedded `CartLineModel` that
 * existed before Phase 4A.5 was removed for being genuinely unused at the
 * time (no cart mutation routes existed yet to read or write it) — not
 * because the pattern itself was rejected.
 *
 * **Line identity is `(cartId, variantId, normalizedNote)`**, carried by
 * the derived `lineIdentityKey` — the same compound-invariant technique
 * `Variant.variantKey` and `Wishlist.customerProductKey` already use in
 * this repo, forced by the same constraint: `@Unique()` builds
 * single-field indexes only. See `buildCartLineIdentityKey()` below, the
 * one place this key is computed.
 */
@MongoSchema({ timestamps: true })
export class CartLineSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => CartSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Cart" })
  cartId!: mongoose.Types.ObjectId;

  @Relation(() => VariantSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Variant" })
  variantId!: mongoose.Types.ObjectId;

  @MongoField({ type: Number, required: true, min: 1 })
  quantity!: number;

  @MongoField({ type: String, required: false })
  note?: string;

  /** `<cartId>|<variantId>|<normalizedNote>` — see class doc comment. Computed and set by the application layer, the same convention `variantKey`/`customerProductKey` follow. */
  @Unique()
  @MongoField({ type: String, required: true })
  lineIdentityKey!: string;
}

// Forward declarations
class CartSchema {
  _id!: mongoose.Types.ObjectId;
}
class VariantSchema {
  _id!: mongoose.Types.ObjectId;
}

export const CartLineModel = createMongoModel("CartLine", CartLineSchema);

/** The canonical `lineIdentityKey` form — the one place it is computed, so every writer agrees on the format. */
export function buildCartLineIdentityKey(
  cartId: mongoose.Types.ObjectId | string,
  variantId: mongoose.Types.ObjectId | string,
  normalizedNote: string | undefined
): string {
  return `${cartId.toString()}|${variantId.toString()}|${normalizedNote ?? ""}`;
}
