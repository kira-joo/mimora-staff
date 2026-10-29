import { toMoney } from "@kira-joo/toolkit-common";
import { describe, expect, it } from "vitest";
import { meetsOrderMinimum, resolveShipping } from "./resolve-shipping";
import { addDays, zonedDate } from "../reports/zoned-calendar";
import type { OperatingSchedule, ShippingInput } from "./shipping.types";

const CAIRO_TZ = "Africa/Cairo";
/** An instant written the way the store's clock reads it: Cairo is UTC+3 in August 2026 (summer time). */
const cairo = (localDateTime: string) => new Date(`${localDateTime}:00+03:00`);
/** The store-calendar day an instant falls on. */
const day = (instant: Date) => zonedDate(instant, CAIRO_TZ);
const ALWAYS_OPEN: OperatingSchedule = { weekly: [], exceptions: [] };

const CAIRO = { zone: "cairo", fee: toMoney("25.00"), estimatedDays: 2, minimumOrder: toMoney("0.00") };
const ALEXANDRIA = { zone: "alexandria", fee: toMoney("40.00"), estimatedDays: 4, minimumOrder: toMoney("0.00") };

function input(overrides: Partial<ShippingInput> = {}): ShippingInput {
  return {
    mode: "DELIVERY",
    zoneName: "cairo",
    zones: [CAIRO, ALEXANDRIA],
    deliveryEnabled: true,
    pickupEnabled: true,
    shippingFeeMode: "BY_ZONE",
    defaultDispatchLeadDays: 1,
    placedAt: cairo("2026-08-28T10:00"), // Friday, well before any cutoff
    timeZone: CAIRO_TZ,
    operatingHours: ALWAYS_OPEN,
    maxDaysAhead: 14,
    ...overrides,
  };
}

describe("capability switches", () => {
  it("refuses delivery when the merchant has it turned off", () => {
    expect(resolveShipping(input({ deliveryEnabled: false }))).toEqual({
      resolvable: false,
      reason: "MODE_DISABLED",
    });
  });

  it("refuses pickup when the merchant has it turned off", () => {
    expect(resolveShipping(input({ mode: "PICKUP", pickupEnabled: false }))).toEqual({
      resolvable: false,
      reason: "MODE_DISABLED",
    });
  });
});

describe("zone resolution", () => {
  it("refuses a zone name that isn't configured", () => {
    expect(resolveShipping(input({ zoneName: "sinai" }))).toEqual({ resolvable: false, reason: "ZONE_NOT_FOUND" });
  });

  it("resolves the matched zone's fee", () => {
    const result = resolveShipping(input({ zoneName: "alexandria" }));
    expect(result.resolvable).toBe(true);
    if (result.resolvable) {
      expect(result.zone).toBe("alexandria");
      expect(result.fee.toFixed(2)).toBe("40.00");
    }
  });
});

describe("pickup", () => {
  it("has no fee and no zone", () => {
    const result = resolveShipping(input({ mode: "PICKUP" }));
    expect(result.resolvable).toBe(true);
    if (result.resolvable) {
      expect(result.fee.isZero()).toBe(true);
      expect(result.zone).toBeUndefined();
    }
  });

  it("promises a single ready-by day, not a range", () => {
    const result = resolveShipping(input({ mode: "PICKUP", defaultDispatchLeadDays: 2 }));
    if (result.resolvable) {
      expect(result.promisedWindow.from.getTime()).toBe(result.promisedWindow.to.getTime());
      expect(result.promisedWindow.from.getTime()).toBe(result.dispatchBy.getTime());
    }
  });
});

describe("dispatch lead time and the cutoff boundary", () => {
  it("dispatches N calendar days later with no cutoff configured", () => {
    const result = resolveShipping(input({ defaultDispatchLeadDays: 1, placedAt: cairo("2026-08-28T23:59") }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-29");
  });

  it("stays on the same day when placed before the cutoff", () => {
    const result = resolveShipping(input({ defaultDispatchLeadDays: 2, cutoffTime: "16:00", placedAt: cairo("2026-08-28T15:59") }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30"); // 28 + 2
  });

  it("pushes to the next day's count when placed at or after the cutoff", () => {
    const result = resolveShipping(input({ defaultDispatchLeadDays: 2, cutoffTime: "16:00", placedAt: cairo("2026-08-28T16:00") }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-31"); // (28 + 1) + 2
  });

  it("rolls the dispatch date over a month boundary", () => {
    const result = resolveShipping(input({ defaultDispatchLeadDays: 3, placedAt: cairo("2026-08-30T10:00") }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-09-02");
  });

  it("returns the instant the dispatch day begins in the store's zone", () => {
    const result = resolveShipping(input({ defaultDispatchLeadDays: 1 }));
    // 29 August 00:00 in Cairo (UTC+3) is 28 August 21:00 UTC.
    expect(result.resolvable && result.dispatchBy.toISOString()).toBe("2026-08-28T21:00:00.000Z");
  });
});

describe("the store's time zone, not the server's", () => {
  // 22:30 UTC on 28 August is 01:30 on 29 August in Cairo. A server reading its own (UTC) clock
  // would call it still the 28th and promise a day too early.
  it("counts lead days from the store's date when UTC is still on the previous day", () => {
    const result = resolveShipping(input({ defaultDispatchLeadDays: 1, placedAt: new Date("2026-08-28T22:30:00Z") }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30"); // UTC arithmetic would say 29
  });

  // 12:30 UTC is 15:30 in Cairo: past a 14:00 cutoff there, but before it on a UTC clock.
  it("judges the cutoff on the store's clock", () => {
    const result = resolveShipping(input({ defaultDispatchLeadDays: 1, cutoffTime: "14:00", placedAt: new Date("2026-08-28T12:30:00Z") }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30"); // UTC clock: before the cutoff, so 29
  });

  it("applies the zone's winter offset too", () => {
    // 22:30 UTC on 10 January is 00:30 on 11 January in Cairo (UTC+2).
    const result = resolveShipping(input({ defaultDispatchLeadDays: 1, placedAt: new Date("2027-01-10T22:30:00Z") }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2027-01-12");
    expect(result.resolvable && result.dispatchBy.toISOString()).toBe("2027-01-11T22:00:00.000Z");
  });
});

describe("the promised window", () => {
  it("spans from dispatch to the zone's estimated arrival", () => {
    const result = resolveShipping(input({ zoneName: "alexandria", defaultDispatchLeadDays: 1, placedAt: cairo("2026-08-28T10:00") }));
    expect(result.resolvable && day(result.promisedWindow.from)).toBe("2026-08-29"); // dispatch: +1 day
    expect(result.resolvable && day(result.promisedWindow.to)).toBe("2026-09-01"); // arrival: +4 days rolls into September
  });

  it("never promises arrival before dispatch, even if a zone is configured faster than the dispatch lead time", () => {
    // A zone estimated at 1 day cannot arrive before a 3-day dispatch lead.
    const fastZone = { zone: "nearby", fee: toMoney("10.00"), estimatedDays: 1, minimumOrder: toMoney("0.00") };
    const result = resolveShipping(input({ zones: [fastZone], zoneName: "nearby", defaultDispatchLeadDays: 3 }));
    if (!result.resolvable) throw new Error("expected a resolvable result");
    expect(result.promisedWindow.to.getTime()).toBeGreaterThanOrEqual(result.promisedWindow.from.getTime());
    expect(result.promisedWindow.to.getTime()).toBe(result.dispatchBy.getTime());
  });
});

/** Egypt's working week: Sunday to Thursday, 09:00-17:00, closed Friday and Saturday. */
const SUN_THU: OperatingSchedule = {
  weekly: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, ranges: [{ open: "09:00", close: "17:00" }] })),
  exceptions: [],
};
// 2026-08-27 is a Thursday; 28 Friday, 29 Saturday, 30 Sunday, 31 Monday.
const THURSDAY_MORNING = cairo("2026-08-27T10:00");
const exception = (date: string, closed: boolean, ranges: Array<{ open: string; close: string }> = []) => ({ date: new Date(`${date}T00:00:00Z`), closed, ranges });

describe("operating hours", () => {
  it("never dispatches on a closed weekday: Thursday + 1 lands on Sunday, past Friday and Saturday", () => {
    const result = resolveShipping(input({ operatingHours: SUN_THU, placedAt: THURSDAY_MORNING, defaultDispatchLeadDays: 1 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30");
  });

  it("keeps an open day as it is", () => {
    const result = resolveShipping(input({ operatingHours: SUN_THU, placedAt: cairo("2026-08-30T10:00"), defaultDispatchLeadDays: 1 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-31");
  });

  it("skips an exception date the store is closed on", () => {
    const hours = { ...SUN_THU, exceptions: [exception("2026-08-30", true)] };
    const result = resolveShipping(input({ operatingHours: hours, placedAt: THURSDAY_MORNING, defaultDispatchLeadDays: 1 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-31"); // Sunday is a holiday
  });

  it("opens a normally closed day when an exception gives it hours", () => {
    const hours = { ...SUN_THU, exceptions: [exception("2026-08-28", false, [{ open: "10:00", close: "14:00" }])] };
    const result = resolveShipping(input({ operatingHours: hours, placedAt: THURSDAY_MORNING, defaultDispatchLeadDays: 1 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-28");
  });

  it("an exception replaces the weekly hours for its date, including their closing time", () => {
    // Thursday normally closes at 17:00; this Thursday closes at 12:00, so a 13:00 order is after hours.
    const hours = { ...SUN_THU, exceptions: [exception("2026-08-27", false, [{ open: "09:00", close: "12:00" }])] };
    const result = resolveShipping(input({ operatingHours: hours, placedAt: cairo("2026-08-27T13:00"), defaultDispatchLeadDays: 0 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30");
  });

  it("an order placed after closing time starts counting the next day", () => {
    // Sunday 18:00, lead 0: the store closed at 17:00, so it cannot dispatch today.
    const result = resolveShipping(input({ operatingHours: SUN_THU, placedAt: cairo("2026-08-30T18:00"), defaultDispatchLeadDays: 0 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-31");
  });

  it("an order placed during opening hours can still dispatch the same day", () => {
    const result = resolveShipping(input({ operatingHours: SUN_THU, placedAt: cairo("2026-08-30T16:59"), defaultDispatchLeadDays: 0 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30");
  });

  it("closing time and the cutoff both push, but only once", () => {
    // After the 16:00 cutoff and after the 17:00 close: one day, not two.
    const result = resolveShipping(input({ operatingHours: SUN_THU, cutoffTime: "16:00", placedAt: cairo("2026-08-30T18:00"), defaultDispatchLeadDays: 0 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-31");
  });

  it("an order placed on a closed day counts from that day, then rolls to the next open one", () => {
    const result = resolveShipping(input({ operatingHours: SUN_THU, placedAt: cairo("2026-08-28T10:00"), defaultDispatchLeadDays: 0 })); // Friday
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30");
  });

  it("pickup is ready on an open day, never a closed one", () => {
    const result = resolveShipping(input({ mode: "PICKUP", operatingHours: SUN_THU, placedAt: THURSDAY_MORNING, defaultDispatchLeadDays: 1 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30");
    expect(result.resolvable && day(result.promisedWindow.to)).toBe("2026-08-30");
  });

  it("a FLAT-fee store respects the hours too", () => {
    const result = resolveShipping(input({ shippingFeeMode: "FLAT", operatingHours: SUN_THU, placedAt: THURSDAY_MORNING, defaultDispatchLeadDays: 1 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30");
  });

  it("delivery arrives on an open day as well", () => {
    // Cairo estimates 2 days: Thursday + 2 = Saturday (closed), so the arrival is Sunday.
    const result = resolveShipping(input({ operatingHours: SUN_THU, placedAt: THURSDAY_MORNING, defaultDispatchLeadDays: 1 }));
    expect(result.resolvable && day(result.promisedWindow.from)).toBe("2026-08-30");
    expect(result.resolvable && day(result.promisedWindow.to)).toBe("2026-08-30");
  });

  it("refuses when a configured schedule is closed every day", () => {
    const allClosed: OperatingSchedule = { weekly: [{ weekday: 0, ranges: [] }], exceptions: [] };
    expect(resolveShipping(input({ operatingHours: allClosed }))).toEqual({ resolvable: false, reason: "NO_OPERATING_DAY" });
  });

  it("treats an empty schedule as hours not configured — open every day, not closed every day", () => {
    const result = resolveShipping(input({ operatingHours: ALWAYS_OPEN, placedAt: cairo("2026-08-28T10:00"), defaultDispatchLeadDays: 1 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-29"); // a Saturday, with no schedule to say otherwise
  });

  it("an exception closes a day even when no weekly schedule is configured", () => {
    const result = resolveShipping(input({ operatingHours: { weekly: [], exceptions: [exception("2026-08-29", true)] }, defaultDispatchLeadDays: 1 }));
    expect(result.resolvable && day(result.dispatchBy)).toBe("2026-08-30");
  });
});

describe("maxDaysAhead (the booking window)", () => {
  // Alexandria is 4 days out from Friday 28 August: arrival on 1 September.
  it("refuses a promise that reaches further out than the window", () => {
    expect(resolveShipping(input({ zoneName: "alexandria", maxDaysAhead: 3 }))).toEqual({ resolvable: false, reason: "BEYOND_BOOKING_WINDOW" });
  });

  it("allows a promise that lands exactly on the last bookable day", () => {
    expect(resolveShipping(input({ zoneName: "alexandria", maxDaysAhead: 4 })).resolvable).toBe(true);
  });

  it("measures from the placement day on the store's clock", () => {
    // 22:30 UTC on 28 August is already the 29th in Cairo, so Alexandria's 4 days end on 2 September: 4 days ahead.
    const placedAt = new Date("2026-08-28T22:30:00Z");
    expect(resolveShipping(input({ zoneName: "alexandria", placedAt, maxDaysAhead: 4 })).resolvable).toBe(true);
    expect(resolveShipping(input({ zoneName: "alexandria", placedAt, maxDaysAhead: 3 }))).toEqual({ resolvable: false, reason: "BEYOND_BOOKING_WINDOW" });
  });

  it("is what a long closure runs into: the next open day is past the window", () => {
    // Closed for the whole of the next fortnight.
    const closures = Array.from({ length: 14 }, (_, offset) => exception(addDays("2026-08-29", offset), true));
    const result = resolveShipping(input({ operatingHours: { weekly: [], exceptions: closures }, maxDaysAhead: 7, defaultDispatchLeadDays: 1 }));
    expect(result).toEqual({ resolvable: false, reason: "BEYOND_BOOKING_WINDOW" });
  });

  it("applies to pickup as well", () => {
    expect(resolveShipping(input({ mode: "PICKUP", defaultDispatchLeadDays: 5, maxDaysAhead: 2 }))).toEqual({ resolvable: false, reason: "BEYOND_BOOKING_WINDOW" });
  });
});

describe("meetsOrderMinimum", () => {
  it("is always true when no minimum is configured", () => {
    expect(meetsOrderMinimum(toMoney("0.01"), undefined)).toBe(true);
  });

  it("is true at or above the minimum", () => {
    expect(meetsOrderMinimum(toMoney("50.00"), toMoney("50.00"))).toBe(true);
    expect(meetsOrderMinimum(toMoney("50.01"), toMoney("50.00"))).toBe(true);
  });

  it("is false below the minimum", () => {
    expect(meetsOrderMinimum(toMoney("49.99"), toMoney("50.00"))).toBe(false);
  });
});

describe("which order minimum applies", () => {
  const storeWide = toMoney("150.00");
  const minimumOf = (overrides: Partial<ShippingInput>) => {
    const result = resolveShipping(input({ storeWideOrderMinimum: storeWide, ...overrides }));
    return result.resolvable ? result.orderMinimum?.toFixed(2) : "unresolvable";
  };

  it("a zone with its own minimum uses it", () => {
    expect(minimumOf({ zones: [{ ...CAIRO, minimumOrder: toMoney("300.00") }] })).toBe("300.00");
  });

  it("a zone whose minimum is unset falls back to the store-wide one", () => {
    const { minimumOrder: _unset, ...cairoWithoutMinimum } = CAIRO;
    expect(minimumOf({ zones: [cairoWithoutMinimum] })).toBe("150.00");
  });

  it("a zone minimum of zero is a real 'no minimum here', not unset", () => {
    expect(minimumOf({ zones: [CAIRO] })).toBe("0.00");
  });

  it("with no store-wide minimum either, there is none", () => {
    const { minimumOrder: _unset, ...cairoWithoutMinimum } = CAIRO;
    const result = resolveShipping(input({ zones: [cairoWithoutMinimum] }));
    expect(result.resolvable && result.orderMinimum).toBeUndefined();
  });

  it("a FLAT store with no flat fee charges nothing", () => {
    const result = resolveShipping(input({ shippingFeeMode: "FLAT" }));
    expect(result.resolvable && result.fee.toFixed(2)).toBe("0.00");
  });
});
