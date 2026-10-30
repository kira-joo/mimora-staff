import { ZERO, type Money } from "@kira-joo/toolkit-common";
import type { OperatingSchedule, ShippingInput, ShippingResult, ShippingZoneConfig } from "./shipping.types";
import { addDays, advanceShippingDays, clockToMinutes, dayHours, daysBetween, nextOpenDay, nextShippingDay, startOfStoreDay, zonedDate, zonedMinutesOfDay } from "./store-calendar";

/**
 * Zone resolution, fee, dispatch lead time, and the promised delivery window
 * — all in **days**, per the Phase 3 spec. Pure: `placedAt` is passed in
 * rather than read from a clock, so a merchant's cutoff-time boundary is
 * exhaustively testable.
 *
 * **Days are the STORE's days.** `placedAt` is an instant; "today", the
 * cutoff and every promised date are read in `timeZone` (`storeTimeZone()`),
 * never with the server's `Date` getters, and the returned dates are the
 * instant each store-calendar day begins. Operating hours then move the
 * dispatch (and arrival, and pickup-ready) day onto an open day, and
 * `maxDaysAhead` bounds how far out the promise may reach.
 *
 * **Phase 4A.5 closes two gaps this engine's own prior doc comment
 * disclosed as blocked:**
 *
 * 1. Zones now come from the standalone `DeliveryZone` collection (promoted
 *    from `StoreProfile.shippingZones[]` by the architecture review), which
 *    carries its own `minimumOrder` per zone — MDS §8.5's shape, previously
 *    unavailable because the schema that would back it did not exist.
 * 2. `shippingFeeMode: "FLAT"` is now implemented: `flatShippingFee`
 *    regardless of destination, no zone lookup, no zone-specific minimum —
 *    the store-wide `storeWideOrderMinimum` applies instead. Previously
 *    selectable with no implementation behind it.
 *
 * **Shipping days (business-day counting).** When `shippingDays` is set, a
 * DELIVERY promise counts SHIPPING days instead of calendar days, and the
 * store's weekly opening hours play no part in it (they stay what the
 * storefront displays): counting starts on the first shipping day on or after
 * the placement day (the day after, past the cutoff), and every lead time
 * advances that many shipping days, the start being day 0. A dated exception
 * marked closed stops shipping too. Without `shippingDays` the original
 * calendar-day algorithm runs unchanged. PICKUP is a store-hours concern and
 * always uses the operating hours.
 *
 * **The window.** It runs from dispatch to the zone's latest estimate, as
 * before; a zone's `estimatedDaysMin` (its earliest estimate) moves the start
 * of the window later — never before dispatch, and never past its end.
 */
export function resolveShipping(input: ShippingInput): ShippingResult {
  if (input.mode === "DELIVERY" && !input.deliveryEnabled) {
    return { resolvable: false, reason: "MODE_DISABLED" };
  }
  if (input.mode === "PICKUP" && !input.pickupEnabled) {
    return { resolvable: false, reason: "MODE_DISABLED" };
  }

  const { timeZone } = input;
  const placedDate = zonedDate(input.placedAt, timeZone);
  const shippingDays = input.mode === "DELIVERY" && input.shippingDays && input.shippingDays.length > 0 ? input.shippingDays : undefined;

  // Day 0 of the count, and how a lead time advances from it: shipping days when configured, else calendar days moved onto an open day.
  const startDate = shippingDays ? nextShippingDay(afterCutoff(input) ? addDays(placedDate, 1) : placedDate, shippingDays, input.operatingHours) : firstCountedDay(input, placedDate);
  if (!startDate) return { resolvable: false, reason: "NO_OPERATING_DAY" };
  const advance = (days: number) => (shippingDays ? advanceShippingDays(startDate, days, shippingDays, input.operatingHours) : resolveDate(startDate, days, input.operatingHours));

  const dispatchDate = advance(input.defaultDispatchLeadDays);
  if (!dispatchDate) return { resolvable: false, reason: "NO_OPERATING_DAY" };

  let windowStart = dispatchDate;
  let arrivalDate = dispatchDate;
  let zone: ShippingZoneConfig | undefined;

  if (input.mode === "DELIVERY" && input.shippingFeeMode === "BY_ZONE") {
    zone = input.zones.find((candidate) => candidate.zone === input.zoneName);
    if (!zone) return { resolvable: false, reason: "ZONE_NOT_FOUND" };

    const estimatedDate = advance(zone.estimatedDays);
    if (!estimatedDate) return { resolvable: false, reason: "NO_OPERATING_DAY" };
    // The zone's own estimate can never resolve to a date before dispatch —
    // whichever is later is the honest promise.
    arrivalDate = estimatedDate > dispatchDate ? estimatedDate : dispatchDate;

    if (zone.estimatedDaysMin !== undefined) {
      const earliestDate = advance(zone.estimatedDaysMin);
      if (!earliestDate) return { resolvable: false, reason: "NO_OPERATING_DAY" };
      // Never before dispatch, never past the latest estimate.
      windowStart = earliestDate > dispatchDate ? earliestDate : dispatchDate;
      if (windowStart > arrivalDate) windowStart = arrivalDate;
    }
  }

  // The booking window: a promise further out than the merchant allows customers to book is not offered.
  if (daysBetween(placedDate, arrivalDate) > input.maxDaysAhead) {
    return { resolvable: false, reason: "BEYOND_BOOKING_WINDOW" };
  }

  const dispatchBy = startOfStoreDay(dispatchDate, timeZone);
  const arrivalBy = startOfStoreDay(arrivalDate, timeZone);

  if (input.mode === "PICKUP") {
    // No transit time to add — "ready by" is a single day, not a range.
    return {
      resolvable: true,
      fee: ZERO,
      dispatchBy,
      promisedWindow: { from: dispatchBy, to: dispatchBy },
      orderMinimum: input.storeWideOrderMinimum,
    };
  }

  if (!zone) {
    // `FLAT`: no zone concept at all — "regardless of destination" means exactly that.
    return {
      resolvable: true,
      fee: input.flatShippingFee ?? ZERO,
      dispatchBy,
      promisedWindow: { from: dispatchBy, to: dispatchBy },
      orderMinimum: input.storeWideOrderMinimum,
    };
  }

  return {
    resolvable: true,
    fee: zone.fee,
    zone: zone.zone,
    zoneId: zone.zoneId,
    dispatchBy,
    promisedWindow: { from: startOfStoreDay(windowStart, timeZone), to: arrivalBy },
    // The zone's own minimum wins when set; the store-wide value is the floor otherwise.
    orderMinimum: zone.minimumOrder ?? input.storeWideOrderMinimum,
  };
}

/**
 * The calendar day lead-day counting starts from. An order placed at or after
 * the cutoff, or after the store has closed for the day, starts counting the
 * following day — all measured on the STORE's clock, so a server in another
 * zone reaches the same answer.
 */
function firstCountedDay(input: ShippingInput, placedDate: string): string {
  const minutes = zonedMinutesOfDay(input.placedAt, input.timeZone);

  if (afterCutoff(input)) {
    return addDays(placedDate, 1);
  }

  const today = dayHours(placedDate, input.operatingHours);
  if (today.open && today.lastCloseMinute !== undefined && minutes >= today.lastCloseMinute) {
    return addDays(placedDate, 1);
  }
  return placedDate;
}

/** Whether the order was placed at or after the daily cutoff, on the store's clock. */
function afterCutoff(input: ShippingInput): boolean {
  return input.cutoffTime !== undefined && zonedMinutesOfDay(input.placedAt, input.timeZone) >= clockToMinutes(input.cutoffTime);
}

/**
 * `leadDays` calendar days after `startDate`, then forward to the first day the
 * store is open — nothing is promised for a closed weekday or an exception
 * date. `null` when the schedule never opens.
 */
function resolveDate(startDate: string, leadDays: number, schedule: OperatingSchedule): string | null {
  return nextOpenDay(addDays(startDate, leadDays), schedule);
}

/**
 * Checks a subtotal against the effective minimum `resolveShipping` already
 * resolved (`ShippingResult.orderMinimum` on a resolvable result) —
 * zone-specific when one applied, store-wide otherwise.
 */
export function meetsOrderMinimum(subtotal: Money, orderMinimum: Money | undefined): boolean {
  if (!orderMinimum) return true;
  return subtotal.greaterThanOrEqualTo(orderMinimum);
}
