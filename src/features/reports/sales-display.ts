import type { SalesGranularity } from "src/api/reports.endpoints";

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" });
const MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short", year: "numeric" });

/**
 * A report period as staff read it. The API's period keys are already
 * store-local calendar dates (`2026-10-02`, `2026-10`); they are formatted as
 * UTC dates so no viewer time zone can shift them by a day.
 */
export function periodLabel(period: string, granularity: SalesGranularity): string {
  const [year, month, day] = period.split("-").map(Number);
  if (!year || !month) return period;
  const date = new Date(Date.UTC(year, month - 1, granularity === "day" ? (day ?? 1) : 1));
  return granularity === "day" ? DAY.format(date) : MONTH.format(date);
}

/**
 * A bar's length as a share (0–1) of the largest value in view. Display only —
 * the amounts themselves are shown from the API's strings; this number never
 * feeds a total. A negative period (refunds above sales) draws no bar.
 */
export function barShare(value: string, values: readonly string[]): number {
  const max = Math.max(0, ...values.map(Number));
  const own = Number(value);
  if (!(max > 0) || !(own > 0)) return 0;
  return Math.min(1, own / max);
}

/** A money string below zero, e.g. "-120.00" — a period whose refunds exceed its sales. */
export const isNegative = (value: string): boolean => value.trim().startsWith("-");

