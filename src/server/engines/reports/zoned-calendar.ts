/**
 * Calendar arithmetic in an IANA time zone, with no dependency beyond `Intl`.
 *
 * A calendar date is a `YYYY-MM-DD` string. Stepping days and months is pure
 * calendar math (time-zone independent); only two operations need the zone:
 * which date an instant falls on, and the instant a date begins.
 *
 * "Begins" is the first instant whose local date is that date — usually local
 * midnight, but on a day whose midnight is skipped by a daylight-saving jump
 * (as in Africa/Cairo's spring change) it is the instant of the jump.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function localParts(instant: number, timeZone: string) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

/** Throws `RangeError` for anything `Intl` does not recognise as a time zone. */
export function assertTimeZone(timeZone: string): void {
  formatterFor(timeZone);
}

/** The local calendar date an instant falls on. */
export function zonedDate(instant: Date, timeZone: string): string {
  const { year, month, day } = localParts(instant.getTime(), timeZone);
  return formatDate(year, month, day);
}

/** The zone's UTC offset at an instant, in milliseconds (positive east of UTC). */
function offsetAt(instant: number, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The first instant of a calendar date in the zone. */
export function startOfZonedDate(date: string, timeZone: string): Date {
  const [year, month, day] = parseDate(date);
  const midnightAsUtc = Date.UTC(year, month - 1, day);
  const day1 = 24 * 60 * 60 * 1000;

  // The offset in force just before and just after the date covers every
  // transition that could fall on it; the right candidate is the one that is
  // on this date while the instant before it is not.
  const candidates = [offsetAt(midnightAsUtc - day1, timeZone), offsetAt(midnightAsUtc + day1, timeZone)]
    .map((offset) => midnightAsUtc - offset)
    .filter((instant) => zonedDate(new Date(instant), timeZone) === date && zonedDate(new Date(instant - 1), timeZone) !== date)
    .sort((a, b) => a - b);

  if (candidates.length > 0) return new Date(candidates[0]!);
  // Only reachable for a zone with two transitions inside 48 hours; fall back to the offset at local midnight.
  return new Date(midnightAsUtc - offsetAt(midnightAsUtc, timeZone));
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** First day of the month `months` away from the month containing `date`. */
export function addMonths(date: string, months: number): string {
  const [year, month] = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** `null` unless `value` is a real `YYYY-MM-DD` calendar date. */
export function parseCalendarDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return value;
}

function parseDate(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

function formatDate(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}
