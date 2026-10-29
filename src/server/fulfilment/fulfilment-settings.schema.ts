import { MongoField, MongoSchema, moneyField, createMongoModel } from "@kira-joo/backend-toolkit-mongoose";
import type { Money } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * FulfilmentSettings — merchant-configured switches for how orders move.
 *
 * Corrective fix: this entity did not exist at all in the original v1 of
 * Phase 2, even though the canonical MDS §8.1 defines it and §16 states its
 * governing rule explicitly — **every capability is a switch**: a merchant can
 * turn pickup off entirely and be delivery-only, or delivery off and be
 * pickup-only, or (a first-class, tested state) both off, in which case the
 * store cannot accept orders at all.
 *
 * Singleton per deployment, same convention as `StoreProfile`.
 *
 * **Phase 4A.5:** `tax{}` moved here from `StoreProfile` (MDS §8.1 places it
 * on this entity; the prior placement was a disclosed-but-unjustified
 * deviation). `zones` are no longer represented here at all — see the
 * standalone `DeliveryZone` collection; `shippingFeeMode: "BY_ZONE"` now
 * resolves against that collection instead of `StoreProfile.shippingZones`.
 * `flatShippingFee` is new — `"FLAT"` was previously selectable with no
 * backing value anywhere (the shipping engine's own doc comment disclosed
 * this as an unimplemented path); implementing it was small enough to do
 * properly rather than leaving a selectable option with no behaviour behind
 * it.
 */
@MongoSchema({ timestamps: true })
export class FulfilmentSettingsSchema {
  _id!: mongoose.Types.ObjectId;

  @MongoField({ type: Boolean, default: true })
  deliveryEnabled!: boolean;

  @MongoField({ type: Boolean, default: false })
  pickupEnabled!: boolean;

  @MongoField({ type: Number, required: true, default: 1 })
  defaultDispatchLeadDays!: number;

  /**
   * Orders placed after this time of day (HH:mm, in the store's time zone —
   * `STORE_TIMEZONE`, one per deployment, so no per-record zone field) start
   * dispatch lead-day counting the following day.
   */
  @MongoField({ type: String, required: false })
  cutoffTime?: string;

  /**
   * The booking window, in days: the furthest day ahead of today (store calendar)
   * that an order may promise. `resolveShipping` refuses with
   * `BEYOND_BOOKING_WINDOW` when the promised window would end more than this
   * many days after the placement day — which is how a long closure in the
   * operating hours, or a very slow zone, stops an order whose date is too far
   * out to be honest. Nothing is offered a date further out than this.
   */
  @MongoField({ type: Number, required: true, default: 14 })
  maxDaysAhead!: number;

  /** Store-wide fallback minimum — used for PICKUP orders (no zone applies) and as the floor when a matched `DeliveryZone.minimumOrder` is unset. */
  @MongoField(moneyField())
  orderMinimum?: Money;

  /**
   * `FLAT` charges `flatShippingFee` regardless of destination; `BY_ZONE`
   * resolves the fee from the `DeliveryZone` collection.
   */
  @MongoField({ type: String, enum: ["FLAT", "BY_ZONE"], default: "BY_ZONE" })
  shippingFeeMode!: "FLAT" | "BY_ZONE";

  /** Only consulted when `shippingFeeMode === "FLAT"`. */
  @MongoField(moneyField())
  flatShippingFee?: Money;

  @MongoField({ type: Boolean, default: true })
  allowGuestCheckout!: boolean;

  /**
   * Moved from `StoreProfile` (Phase 4A.5) — MDS §8.1 places tax
   * configuration on `FulfilmentSettings`, not on store identity.
   */
  @MongoField({
    type: new mongoose.Schema(
      { mode: { type: String, enum: ["INCLUDED", "ADDED"], required: true }, rate: { type: Number, required: true, default: 0 } },
      { _id: false }
    ),
    default: () => ({ mode: "ADDED", rate: 0 }),
  })
  tax!: { mode: "INCLUDED" | "ADDED"; rate: number };

  /**
   * Minutes after placement a customer may self-cancel. Distinct from
   * `Order.customerCancelUntil`, which is the computed per-order deadline
   * (`placedAt + this value`) — this is the merchant-configured window itself.
   */
  @MongoField({ type: Number, required: true, default: 30 })
  customerCancelWindowMinutes!: number;

  @MongoField({ type: Number, required: true, default: 14 })
  returnWindowDays!: number;

  /**
   * The carriers staff can choose when an order ships. A carrier is a name plus a URL template containing
   * `{tracking}` (https only — `carrier-tracking.ts` validates it). An order SNAPSHOTS the carrier's name and the
   * resolved link when staff enter a tracking number, so editing or removing a carrier here never changes a link
   * a customer already has. Empty means no carrier is configured and tracking cannot be entered.
   */
  @MongoField({
    type: [new mongoose.Schema({ key: { type: String, required: true }, name: { type: String, required: true }, urlTemplate: { type: String, required: true } }, { _id: false })],
    default: () => [],
  })
  carriers!: Array<{ key: string; name: string; urlTemplate: string }>;
}

export const FulfilmentSettingsModel = createMongoModel("FulfilmentSettings", FulfilmentSettingsSchema);
