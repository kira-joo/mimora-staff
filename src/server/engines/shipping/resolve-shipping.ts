import { ZERO, type Money } from "@kira-joo/toolkit-common";
import type { OperatingSchedule, ShippingInput, ShippingResult, ShippingZoneConfig } from "./shipping.types";
import { addDays, clockToMinutes, dayHours, daysBetween, nextOpenDay, startOfStoreDay, zonedDate, zonedMinutesOfDay } from "./store-calendar";

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
  const startDate = firstCountedDay(input, placedDate);

  const dispatchDate = resolveDate(startDate, input.defaultDispatchLeadDays, input.operatingHours);
  if (!dispatchDate) return { resolvable: false, reason: "NO_OPERATING_DAY" };

  let arrivalDate = dispatchDate;
  let zone: ShippingZoneConfig | undefined;

  if (input.mode === "DELIVERY" && input.shippingFeeMode === "BY_ZONE") {
    zone = input.zones.find((candidate) => candidate.zone === input.zoneName);
    if (!zone) return { resolvable: false, reason: "ZONE_NOT_FOUND" };

    const estimatedDate = resolveDate(startDate, zone.estimatedDays, input.operatingHours);
    if (!estimatedDate) return { resolvable: false, reason: "NO_OPERATING_DAY" };
    // The zone's own estimate can never resolve to a date before dispatch —
    // whichever is later is the honest promise.
    arrivalDate = estimatedDate > dispatchDate ? estimatedDate : dispatchDate;
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
    promisedWindow: { from: dispatchBy, to: arrivalBy },
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

  if (input.cutoffTime !== undefined && minutes >= clockToMinutes(input.cutoffTime)) {
    return addDays(placedDate, 1);
  }

  const today = dayHours(placedDate, input.operatingHours);
  if (today.open && today.lastCloseMinute !== undefined && minutes >= today.lastCloseMinute) {
    return addDays(placedDate, 1);
  }
  return placedDate;
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
