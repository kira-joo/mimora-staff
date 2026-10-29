import {
  MongoField,
  MongoSchema,
  Relation,
  Unique,
  moneyField,
  imageAssetField,
  createMongoModel,
} from "@kira-joo/backend-toolkit-mongoose";
import type { Money, ImageAsset } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

export const UNITS_OF_MEASURE = ["EACH", "PACK", "BOX"] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

/**
 * Variant — the purchasable unit. Owns price and stock absolutely.
 *
 * Separate collection (not embedded in Product) — forced by evidence:
 * @Unique() builds single-field indexes only, so embedded variants[].sku
 * cannot be enforced at all. Separate collection also keeps stock guard
 * narrowly contended and avoids rewriting large parent on every stock change.
 */
@MongoSchema({ timestamps: true })
export class VariantSchema {
  _id!: mongoose.Types.ObjectId;

  @Relation(() => ProductSchema)
  @MongoField({ type: mongoose.Schema.Types.ObjectId, required: true, ref: "Product" })
  productId!: mongoose.Types.ObjectId;

  @Unique()
  @MongoField({ type: String, required: true, trim: true })
  sku!: string;

  /**
   * Derived, globally-unique key enforcing "exactly one variant per axis combination".
   * Format: <productId>|colour=red|size=m (canonically ordered).
   *
   * Required because compound uniqueness has no primitive; @Unique() is single-field only.
   */
  @Unique()
  @MongoField({ type: String, required: true })
  variantKey!: string;

  /**
   * Option values — exactly one per axis, every axis present.
   * Example: [{key: "colour", value: "red"}, {key: "size", value: "m"}]
   *
   * Keys match Product.optionAxes[].key. Immutable identifiers.
   */
  @MongoField({
    type: [
      new mongoose.Schema(
        {
          key: { type: String, required: true },
          value: { type: String, required: true },
        },
        { _id: false }
      ),
    ],
    default: () => [],
  })
  optionValues!: Array<{ key: string; value: string }>;

  @MongoField(moneyField({ required: true }))
  price!: Money;

  @MongoField(moneyField())
  compareAtPrice?: Money;

  /**
   * Sellable on-hand units — one unambiguous meaning.
   * Returns, damage, receiving get their own movements rather than all mutating this counter.
   */
  @MongoField({ type: Number, required: true, default: 0 })
  stock!: number;

  /** Per-variant override of `InventorySettings.lowStockThreshold`. Absent means the store-wide default applies — in MDS §8.2, present in the prior schema. */
  @MongoField({ type: Number, required: false })
  lowStockThreshold?: number;

  /** Shipping weight in **grams**. Absent means not recorded. Non-negative; decimals allowed. */
  @MongoField({ type: Number, required: false, min: 0 })
  weight?: number;

  /** Package length in **millimetres**. Absent means not recorded. */
  @MongoField({ type: Number, required: false, min: 0 })
  length?: number;

  /** Package width in **millimetres**. Absent means not recorded. */
  @MongoField({ type: Number, required: false, min: 0 })
  width?: number;

  /** Package height in **millimetres**. Absent means not recorded. */
  @MongoField({ type: Number, required: false, min: 0 })
  height?: number;

  /**
   * How the variant is sold: `EACH` (a single item), `PACK` or `BOX`.
   * Fractional selling is excluded from v1 — a quantity is always a whole
   * number of these units.
   */
  @MongoField({ type: String, enum: [...UNITS_OF_MEASURE], default: "EACH" })
  unitOfMeasure!: UnitOfMeasure;

  /** Items inside one unit of sale (a PACK of 6 has `unitsPerSale: 6`). A whole number, at least 1. */
  @MongoField({ type: Number, default: 1, min: 1, validate: { validator: Number.isInteger, message: "unitsPerSale must be a whole number" } })
  unitsPerSale!: number;

  /**
   * Cost price — captured in v1, reported in v2.
   * Must be snapshotted at sale or it is unrecoverable for margin reporting.
   */
  @MongoField(moneyField())
  costPrice?: Money;

  /**
   * Per-variant gallery override — for colour-specific imagery.
   * Falls back to Product.images if absent.
   */
  @MongoField({ type: [imageAssetField().type], default: () => [] })
  galleryOverride?: ImageAsset[];

  @MongoField({ type: Boolean, default: false })
  discontinued!: boolean;

  /**
   * Backorder policy: DENY (default) or CONTINUE_SELLING.
   * Partial-fulfilment workflow is v2; field exists in v1.
   */
  @MongoField({ type: String, enum: ["DENY", "CONTINUE_SELLING"], default: "DENY" })
  backorderPolicy!: "DENY" | "CONTINUE_SELLING";
}

// Forward declaration for relation
class ProductSchema {
  _id!: mongoose.Types.ObjectId;
}

export const VariantModel = createMongoModel("Variant", VariantSchema);
