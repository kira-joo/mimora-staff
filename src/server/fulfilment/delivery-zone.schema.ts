import { Filterable, MongoField, MongoSchema, Searchable, createMongoModel, localizedStringField, moneyField } from "@kira-joo/backend-toolkit-mongoose";
import type { LocalizedString, Money } from "@kira-joo/toolkit-common";
import mongoose from "mongoose";

/**
 * DeliveryZone — standalone collection, new in Phase 4A.5.
 *
 * **Reverses this codebase's own prior placement**, not a new idea:
 * `StoreProfile.shippingZones[]` (flat, no per-zone minimum, no identity,
 * no lifecycle) is retired. This collection is modelled directly on
 * `restaurant-platform-staff`'s working `DeliveryZoneSchema` — a proven
 * shape, not a hypothetical one — adapted only in naming (`leadDays`
 * instead of `estimatedMinutes`, matching this domain's day-granularity
 * dispatch model, and this engine's own `ShippingZoneConfig.estimatedDays`
 * field it already snapshots onto orders).
 *
 * `minimumOrder` here is what `engines/shipping/resolve-shipping.ts`'s own
 * doc comment named as blocked: "MDS §8.5 `DeliveryZone` carries its own
 * `minimumOrder` per zone. The committed `StoreProfileSchema`... has no such
 * field... because the schema that would back a per-zone minimum does not
 * exist." It now exists; `resolveShipping` is updated in the same phase to
 * consume it (falling back to `FulfilmentSettings.orderMinimum` when unset).
 *
 * Coverage is a list of named areas, not a polygon — same
 * `[ASSUMPTION]` as the precedent this was modelled on: staff maintain a
 * list of district names; a polygon editor is a materially larger
 * commitment than v1 justifies. (The list is reference only today — see
 * `areas` below — and a zone is chosen by governorate.)
 *
 * `Order.fulfilment` snapshots the matched zone's name/fee/leadDays at
 * placement time (unchanged behaviour) — a zone changing later, or being
 * soft-deleted, must never alter a historical order's own record.
 */
@MongoSchema({ timestamps: true, softDelete: true })
export class DeliveryZoneSchema {
  _id!: mongoose.Types.ObjectId;

  @Searchable({ subPaths: ["ar", "en"] })
  @MongoField(localizedStringField())
  name!: LocalizedString;

  /**
   * District or area names this zone covers — **informational only**. Matching is by the customer's
   * governorate against this zone's English `name` (`resolveShipping`'s `zone.zone`); the address model
   * (`Address`, `Cart.fulfilmentDraft.address`) carries `city` and `governorate` but no area field, so
   * there is nothing an area list could be matched against. If an address ever gains a district field,
   * area matching is a change to `resolveShipping`'s zone lookup, not a reinterpretation of this list.
   */
  @MongoField({ type: [String], default: () => [] })
  areas!: string[];

  @MongoField(moneyField({ required: true }))
  fee!: Money;

  /**
   * The zone's own order minimum. Absent means the store-wide minimum applies
   * (`resolveShipping`: `zone.minimumOrder ?? storeWideOrderMinimum`) — so it
   * has no default: a default zero would always win and silently disable the
   * store-wide one. Zero, when set, is a real "no minimum in this zone".
   */
  @MongoField(moneyField())
  minimumOrder?: Money;

  /**
   * The latest delivery estimate, in days from the day counting starts (the order day, or the next day past
   * the cutoff) — shipping days when `FulfilmentSettings.shippingDays` is set, calendar days otherwise. Matches
   * `ShippingZoneConfig.estimatedDays`; this domain has no delivery-slot concept, only day-granularity promises.
   */
  @MongoField({ type: Number, required: true, default: 1 })
  leadDays!: number;

  /** The earliest delivery estimate, same unit; absent means the promised window opens at dispatch. Never more than `leadDays`. */
  @MongoField({ type: Number, required: false })
  leadDaysMin?: number;

  @Filterable()
  @MongoField({ type: Boolean, default: true })
  active!: boolean;

  @MongoField({ type: Number, default: 0 })
  order!: number;
}

export const DeliveryZoneModel = createMongoModel("DeliveryZone", DeliveryZoneSchema);
