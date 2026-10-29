import type { HourRange, HoursException, WeeklyHours } from "src/api/fulfilment-settings.endpoints";

export const WHOLE_NUMBER_PATTERN = /^\d+$/;
/** The server's `cutoffTime` pattern, and the shape every hour range uses. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** One area per line → a clean list: trimmed, blanks dropped, repeats removed (first spelling wins). */
export function parseAreas(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const area = line.trim();
    if (area && !seen.has(area)) {
      seen.add(area);
      out.push(area);
    }
  }
  return out;
}

export function areasToText(areas: readonly string[] | undefined): string {
  return (areas ?? []).join("\n");
}

/** The reorder endpoints take the whole new order: `order` is each id's position in the full list. */
export function toOrderEntries(orderedIds: readonly string[]): Array<{ id: string; order: number }> {
  return orderedIds.map((id, order) => ({ id, order }));
}

/**
 * A day's ranges: both ends present as HH:mm. Nothing more — the API accepts
 * any pair of times and no backend rule orders them, so a closing time before
 * the opening time (an overnight shift, 18:00–02:00) is the store's to set.
 */
export function validateRanges(ranges: readonly HourRange[]): string | undefined {
  for (const range of ranges) {
    if (!TIME_PATTERN.test(range.open) || !TIME_PATTERN.test(range.close)) return "Enter both an opening and a closing time.";
  }
  return undefined;
}

/** The week as seven rows, Sunday first; a weekday the server has no entry for is closed (no ranges). */
export function toWeekForm(weekly: readonly WeeklyHours[]): WeeklyHours[] {
  return WEEKDAYS.map((_, weekday) => ({ weekday, ranges: (weekly.find((w) => w.weekday === weekday)?.ranges ?? []).map((r) => ({ ...r })) }));
}

/** Only open days are sent; a day with no ranges is closed. */
export function fromWeekForm(week: readonly WeeklyHours[]): WeeklyHours[] {
  return week.filter((day) => day.ranges.length > 0).map((day) => ({ weekday: day.weekday, ranges: day.ranges.map((r) => ({ open: r.open, close: r.close })) }));
}

/** The server stores a date-only exception as UTC midnight; show and edit its `YYYY-MM-DD`. */
export function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export function toExceptionsForm(exceptions: readonly HoursException[]): HoursException[] {
  return exceptions
    .map((e) => ({ date: toDateInput(e.date), closed: e.closed, ranges: e.ranges.map((r) => ({ ...r })) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Closed days send no ranges; exceptions go out sorted by date. */
export function fromExceptionsForm(exceptions: readonly HoursException[]): HoursException[] {
  return [...exceptions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date, closed: e.closed, ranges: e.closed ? [] : e.ranges.map((r) => ({ open: r.open, close: r.close })) }));
}

export function validateWeek(week: readonly WeeklyHours[]): string | undefined {
  for (const day of week) {
    const problem = validateRanges(day.ranges);
    if (problem) return `${WEEKDAYS[day.weekday]}: ${problem}`;
  }
  return undefined;
}

export function validateExceptions(exceptions: readonly HoursException[]): string | undefined {
  const seen = new Set<string>();
  for (const e of exceptions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return "Pick a date for every exception.";
    if (seen.has(e.date)) return `${e.date} appears more than once.`;
    seen.add(e.date);
    if (!e.closed) {
      if (e.ranges.length === 0) return `${e.date}: add opening hours, or mark it closed.`;
      const problem = validateRanges(e.ranges);
      if (problem) return `${e.date}: ${problem}`;
    }
  }
  return undefined;
}
