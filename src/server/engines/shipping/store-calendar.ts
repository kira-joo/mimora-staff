import { addDays, startOfZonedDate, zonedDate } from "../reports/zoned-calendar";
import type { OperatingSchedule } from "./shipping.types";

/**
 * The store's calendar, for the shipping engine: every "day" here is a
 * `YYYY-MM-DD` in the store's own IANA zone, never the server's. A server
 * running in UTC would otherwise decide that an order placed at 01:30 Cairo
 * time still belongs to yesterday, and count a cutoff of "14:00" against the
 * wrong clock.
 */

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes since local midnight, in `timeZone`, for an instant. */
export function zonedMinutesOfDay(instant: Date, timeZone: string): number {
  let formatter = clockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    clockFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/** "HH:mm" to minutes since midnight. */
export function clockToMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/** Sunday = 0 … Saturday = 6, the numbering `OperatingHours.weekly[].weekday` uses. */
export function weekdayOf(date: string): number {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))).getUTCDay();
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const utc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

export interface DayHours {
  open: boolean;
  /**
   * Minute of the day the last opening range ends. Absent when the day has no
   * stated hours (an unconfigured schedule, or an open exception with no
   * ranges) or runs past midnight — in both cases nothing closes the day early.
   */
  lastCloseMinute?: number;
}

/**
 * Whether the store works on a calendar day, and until when.
 *
 * - A dated exception replaces the weekly schedule for that date: `closed`
 *   closes it, otherwise its ranges are the day's hours.
 * - An EMPTY weekly schedule means hours have not been configured — the store
 *   storefront renders that as "hours not published" — so every day is open.
 *   Treating it as "always closed" would stop a store that has simply not
 *   filled the page in from ever promising a date.
 * - A configured schedule closes any weekday it has no ranges for.
 */
export function dayHours(date: string, schedule: OperatingSchedule): DayHours {
  const exception = schedule.exceptions.find((candidate) => candidate.date.toISOString().slice(0, 10) === date);
  if (exception) {
    if (exception.closed) return { open: false };
    return { open: true, ...lastClose(exception.ranges) };
  }

  if (schedule.weekly.length === 0) return { open: true };

  const entry = schedule.weekly.find((candidate) => candidate.weekday === weekdayOf(date));
  if (!entry || entry.ranges.length === 0) return { open: false };
  return { open: true, ...lastClose(entry.ranges) };
}

function lastClose(ranges: Array<{ open: string; close: string }>): { lastCloseMinute?: number } {
  if (ranges.length === 0) return {};
  let latest = 0;
  for (const range of ranges) {
    const open = clockToMinutes(range.open);
    const close = clockToMinutes(range.close);
    // A range that ends at or before it starts runs past midnight: nothing closes this day early.
    if (close <= open) return {};
    latest = Math.max(latest, close);
  }
  return { lastCloseMinute: latest };
}

/** The first open day on or after `date`, or `null` if none within a year (a schedule that is closed every day). */
export function nextOpenDay(date: string, schedule: OperatingSchedule): string | null {
  let candidate = date;
  for (let step = 0; step < 366; step += 1) {
    if (dayHours(candidate, schedule).open) return candidate;
    candidate = addDays(candidate, 1);
  }
  return null;
}

/**
 * Whether the courier side works on a calendar day — independent of the store's weekly opening hours.
 * Its weekday must be one the merchant ships on (`FulfilmentSettings.shippingDays`, 0 = Sunday), and no dated
 * exception may close it: a date the merchant marked closed (a public holiday) stops shipping too. An OPEN
 * exception never adds a shipping day on an excluded weekday. Weekly store hours play no part.
 */
export function isShippingDay(date: string, shippingDays: readonly number[], schedule: OperatingSchedule): boolean {
  if (!shippingDays.includes(weekdayOf(date))) return false;
  const exception = schedule.exceptions.find((candidate) => candidate.date.toISOString().slice(0, 10) === date);
  return !exception?.closed;
}

/** The first shipping day on or after `date`, or `null` if none within a year. */
export function nextShippingDay(date: string, shippingDays: readonly number[], schedule: OperatingSchedule): string | null {
  let candidate = date;
  for (let step = 0; step < 366; step += 1) {
    if (isShippingDay(candidate, shippingDays, schedule)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return null;
}

/**
 * `count` shipping days after `start` — business-day counting: each step moves to the next shipping day, and
 * `start` itself is day 0 (the same convention as the calendar-day `addDays(start, n)` it replaces). `start` must
 * already be a shipping day. `null` when a step finds no shipping day within a year.
 */
export function advanceShippingDays(start: string, count: number, shippingDays: readonly number[], schedule: OperatingSchedule): string | null {
  let date: string | null = start;
  for (let step = 0; step < count && date; step += 1) date = nextShippingDay(addDays(date, 1), shippingDays, schedule);
  return date;
}

/** The instant a store-calendar day begins. */
export function startOfStoreDay(date: string, timeZone: string): Date {
  return startOfZonedDate(date, timeZone);
}

export { addDays, zonedDate };
