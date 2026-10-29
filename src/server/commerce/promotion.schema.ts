import {
  MongoField,
  MongoSchema,
  Unique,
  localizedStringField,
  moneyField,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * Promotion code for discounts.
 *
 * Corrective fix: the original v1 of this schema only covered a flat,
 * uncategorised percentage/fixed coupon — missing `FREE_SHIPPING`, every
 * scoping condition (category/collection/product/variant), first-order-only,
 * per-customer usage limits, and `stackable`, all of which the canonical MDS
 * §8.2 requires. Restored to that shape here.
 */
@MongoSchema({ timestamps: true })
export class PromotionSchema {
  _id!: mongoose.Types.ObjectId;

  /**
   * Absent means an automatic promotion (applied without a code), per MDS
   * `code?` (null ⇒ automatic). Sparse unique — several documents may have no
   * code at all.
   */
  @Unique({ sparse: true })
  @MongoField({ type: String, required: false, trim: true, uppercase: true })
  code?: string;

  @MongoField(localizedStringField())
  name!: LocalizedString;

  @MongoField(localizedStringField())
  description!: LocalizedString;

  @MongoField({ type: String, enum: ["PERCENT", "FIXED", "FREE_SHIPPING"], required: true })
  type!: "PERCENT" | "FIXED" | "FREE_SHIPPING";

  /**
   * A percentage 0–100 for PERCENT, major units for FIXED, ignored for
   * FREE_SHIPPING.
   */
  /**
   * An exact decimal, never a float: a percentage (0–100) for PERCENT, an
   * amount in major units for FIXED, absent for FREE_SHIPPING. Stored as
   * Decimal128 through `moneyField` — the store's one exact-decimal field —
   * and sent as a decimal string, like every amount.
   */
  @MongoField(moneyField())
  value?: Money;

  /**
   * Eligibility conditions. Every array empty means "no restriction on that
   * axis" — never "excludes everything" — so an unset condition must not
   * become a condition.
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        minSubtotal: moneyField(),
        categories: { type: [mongoose.Schema.Types.ObjectId], default: () => [] },
        collections: { type: [mongoose.Schema.Types.ObjectId], default: () => [] },
        products: { type: [mongoose.Schema.Types.ObjectId], default: () => [] },
        variants: { type: [mongoose.Schema.Types.ObjectId], default: () => [] },
        firstOrderOnly: { type: Boolean, default: false },
        startsAt: { type: Date, required: false },
        endsAt: { type: Date, required: false },
      },
      { _id: false }
    ),
    required: true,
  })
  conditions!: {
    minSubtotal?: Money;
    categories: mongoose.Types.ObjectId[];
    collections: mongoose.Types.ObjectId[];
    products: mongoose.Types.ObjectId[];
    variants: mongoose.Types.ObjectId[];
    firstOrderOnly: boolean;
    startsAt?: Date;
    endsAt?: Date;
  };

  /**
   * Usage caps. `totalUses` is a global ceiling; `perCustomerUses` bounds one
   * customer's repeat use of the same code. Either may be absent, meaning
   * unlimited on that axis.
   */
  @MongoField({
    type: new mongoose.Schema(
      {
        totalUses: { type: Number, required: false },
        perCustomerUses: { type: Number, required: false },
      },
      { _id: false }
    ),
    default: () => ({}),
  })
  limits!: { totalUses?: number; perCustomerUses?: number };

  @MongoField({ type: Number, default: 0 })
  usageCount!: number;

  /**
   * Whether this promotion may combine with another applicable one.
   * [ASSUMPTION: one promotion per order in v1 regardless — see Phase 3's
   * `selectBestPromotion`.] The field exists on the model for when that
   * changes, per the restaurant precedent this workspace already ships.
   */
  @MongoField({ type: Boolean, default: false })
  stackable!: boolean;

  @MongoField({ type: Boolean, default: true })
  active!: boolean;
}

export const PromotionModel = createMongoModel("Promotion", PromotionSchema);
