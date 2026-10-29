import { MongoField, MongoSchema, Relation, Unique, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * Wishlist — one entry per (customer, product) pair, per MDS §8.4. New in
 * this pass (same status as `StockMovement`/`CatalogImportBatch` — not in
 * Phase 4A.5's own checklist, found genuinely missing by the Phase 4B
 * verification pass; required by the shop/admin wishlist routes in the
 * canonical route inventory).
 *
 * **`customerProductKey` — the same compound-invariant pattern
 * `Variant.variantKey` already uses in this repo**, for the same forced
 * reason: `@Unique()` builds single-field indexes only, so "a customer may
 * wishlist a given product at most once" cannot be expressed as a compound
 * unique index directly. A derived, canonically-formed key
 * (`<customerId>|<productId>`) carries `@Unique()` instead.
 */
@MongoSchema({ timestamps: true })
export class WishlistSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => CustomerSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Customer" })
  customerId!: mongoose.Types.ObjectId;

  @Relation(() => ProductSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Product" })
  productId!: mongoose.Types.ObjectId;

  /** `<customerId>|<productId>` — see class doc comment. Computed and set by the application layer at creation, the same convention `variantKey` follows. */
  @Unique()
  @MongoField({ type: String, required: true })
  customerProductKey!: string;
}

// Forward declarations
class CustomerSchema {
  _id!: mongoose.Types.ObjectId;
}
class ProductSchema {
  _id!: mongoose.Types.ObjectId;
}

export const WishlistModel = createMongoModel("Wishlist", WishlistSchema);

/** The canonical `customerProductKey` form — the one place it is computed, so every writer agrees on the format. */
export function buildWishlistKey(customerId: mongoose.Types.ObjectId | string, productId: mongoose.Types.ObjectId | string): string {
  return `${customerId.toString()}|${productId.toString()}`;
}
