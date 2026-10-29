import type { Money } from "@kira-joo/toolkit-common";
import type { FulfilmentMode } from "../order-state/order-state.types";

/**
 * Mirrors one entry of the `DeliveryZone` collection (Phase 4A.5 — promoted
 * from `StoreProfile.shippingZones[]`, which had no per-zone `minimumOrder`
 * at all; this field is what closes that previously-disclosed gap).
 *
 * `zoneId` is optional so this type stays usable in a unit test with a
 * plain fixture zone that has no real `DeliveryZone` document behind it —
 * but every zone `place-order.ts` actually builds from the database has
 * one, and it is what makes `ShippingResult.zoneId`/`Order.fulfilment.zoneId`
 * possible (Phase 4B verification pass — this repo's own `zoneId` schema
 * field existed with nothing populating it until this fix).
 */
export interface ShippingZoneConfig {
  /** The matching key — the zone's English name, which the storefront submits as `governorate`. */
  zone: string;
  /** The zone's name in the ORDER's locale, for the snapshot a customer reads. Matching never uses it. */
  label?: string;
  zoneId?: string;
  fee: Money;
  estimatedDays: number;
  /** The zone's own minimum; absent means the store-wide one applies. */
  minimumOrder?: Money;
}

/**
 * The store's weekly schedule and dated exceptions — the shape of
 * `OperatingHours` (`fulfilment/operating-hours.schema.ts`). Weekdays are
 * 0 (Sunday) to 6 (Saturday); an exception's `date` is the calendar day
 * stored as UTC midnight of its `YYYY-MM-DD`.
 */
export interface OperatingSchedule {
  weekly: Array<{ weekday: number; ranges: Array<{ open: string; close: string }> }>;
  exceptions: Array<{ date: Date; closed: boolean; ranges: Array<{ open: string; close: string }> }>;
}

/**
 * - `MODE_DISABLED` — the merchant turned this fulfilment mode off.
 * - `ZONE_NOT_FOUND` — no active delivery zone matches the address.
 * - `NO_OPERATING_DAY` — a configured schedule that is closed on every day, so there is nothing to promise.
 * - `BEYOND_BOOKING_WINDOW` — the earliest honest promise lies further ahead than `maxDaysAhead` allows.
 */
export type ShippingRejection = "MODE_DISABLED" | "ZONE_NOT_FOUND" | "NO_OPERATING_DAY" | "BEYOND_BOOKING_WINDOW";

export interface ShippingInput {
  mode: FulfilmentMode;
  /** Required for DELIVERY + `BY_ZONE`; ignored for PICKUP and for `FLAT`, neither of which has a zone concept. */
  zoneName?: string;
  zones: ShippingZoneConfig[];
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  /**
   * `FLAT` charges `flatShippingFee` regardless of destination, with no zone
   * lookup — Phase 4A.5, previously selectable with no implementation behind
   * it (the prior version of this engine's own doc comment disclosed this).
   * `BY_ZONE` resolves fee/lead-time/minimum from `zones`, as before.
   */
  shippingFeeMode: "FLAT" | "BY_ZONE";
  flatShippingFee?: Money;
  defaultDispatchLeadDays: number;
  /** "HH:mm", store-local. Absent means no cutoff — every order dispatches the same day. */
  cutoffTime?: string;
  placedAt: Date;
  /** The store's IANA zone (`storeTimeZone()`). Required, never defaulted: "today", the cutoff and every promised date are the store's, not the server's. */
  timeZone: string;
  /** Opening days and hours. Dispatch, delivery and pickup readiness only ever land on an open day. */
  operatingHours: OperatingSchedule;
  /** `FulfilmentSettings.maxDaysAhead` — how far ahead a customer may book: the promised window may not end more than this many days after the placement day. */
  maxDaysAhead: number;
  /** Store-wide fallback minimum (`FulfilmentSettings.orderMinimum`) — used for PICKUP, for `FLAT`, and as the floor when a matched zone's own `minimumOrder` is unset. */
  storeWideOrderMinimum?: Money;
}

export type ShippingResult =
  | {
      resolvable: true;
      fee: Money;
      zone?: string;
      zoneId?: string;
      dispatchBy: Date;
      promisedWindow: { from: Date; to: Date };
      /** The effective minimum to check the order's subtotal against — resolved here so the caller does not re-derive zone-vs-store-wide precedence itself. */
      orderMinimum?: Money;
    }
  | { resolvable: false; reason: ShippingRejection };
