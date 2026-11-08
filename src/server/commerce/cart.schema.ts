import {
  MongoField,
  MongoSchema,
  Relation,
  Unique,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import mongoose from "mongoose";

/**
 * The customer's raw fulfilment SELECTION — never a resolved snapshot.
 * `Order.fulfilment` (see `order.schema.ts`) is the authoritative,
 * historically-frozen shape with `fee`/`zone`/`dispatchBy`/`promisedWindow`;
 * this draft deliberately carries none of that. "Totals are never stored —
 * computed on every read so they cannot go stale" (MDS §8.4) applies to
 * fulfilment cost exactly the same way it applies to the cart subtotal:
 * `POST /quote` is the authoritative resolver, not this draft.
 */
const fulfilmentDraftSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ["DELIVERY", "PICKUP"], required: true },
    address: {
      type: new mongoose.Schema(
        {
          recipientName: { type: String, required: true },
          phone: { type: String, required: true },
          addressLine1: { type: String, required: true },
          addressLine2: { type: String },
          city: { type: String, required: true },
          governorate: { type: String, required: true },
          postalCode: { type: String },
        },
        { _id: false }
      ),
      required: false,
    },
    pickupLocationId: { type: mongoose.Schema.Types.ObjectId, ref: "PickupLocation", required: false },
  },
  { _id: false }
);

export interface CartFulfilmentDraft {
  mode: "DELIVERY" | "PICKUP";
  address?: {
    recipientName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    governorate: string;
    postalCode?: string;
  };
  pickupLocationId?: mongoose.Types.ObjectId;
}

/**
 * Server-owned cart.
 *
 * Identified by cartToken (guest) or customer (signed-in). Lines live in
 * the standalone `CartLineModel` (see `cart-line.schema.ts`), never
 * embedded here — Phase 4B Batch 3's design-checkpoint conversion, mirroring
 * `Order`/`OrderLineModel`'s existing shape in this same codebase.
 */
@MongoSchema({ timestamps: true })
export class CartSchema {
  _id!: mongoose.Types.ObjectId;

  @Unique({ sparse: true })
  @MongoField({ type: String, required: false })
  cartToken?: string;

  /**
   * `@Unique({sparse:true})`, same as `cartToken` — Phase 4B Batch 3.
   * Without it, two concurrent "add the first line" requests for a
   * customer with no cart yet can both pass an upsert's not-found check
   * and both insert, producing two Cart documents for one customer. See
   * `add-cart-line.ts`'s own doc comment for how the resulting duplicate-
   * key race is handled (the same catch-and-reread pattern
   * `mongo-idempotency-store.ts`'s `begin()` already uses in this repo).
   */
  @Unique({ sparse: true })
  @Relation(() => CustomerSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: false, ref: "Customer" })
  customerId?: mongoose.Types.ObjectId;

  @MongoField({ type: fulfilmentDraftSchema, required: false })
  fulfilmentDraft?: CartFulfilmentDraft;

  @MongoField({ type: String, required: false })
  appliedPromotionCode?: string;

  @MongoField({ type: Date, required: false, expires: 0 })
  expiresAt?: Date;
}

// Forward declaration for relation
class CustomerSchema {
  _id!: mongoose.Types.ObjectId;
}

export const CartModel = createMongoModel("Cart", CartSchema);
