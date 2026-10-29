import { ZERO, roundMoney, sum, type Money } from "@kira-joo/toolkit-common";
import { addDays, addMonths, parseCalendarDate, startOfMonth, startOfZonedDate, zonedDate } from "./zoned-calendar";

export type SalesGranularity = "day" | "month";

/** Orders placed in one period, as the database aggregates them: how many, and their exact total. */
export interface OrderBucket {
  period: string;
  orderCount: number;
  grossSales: Money;
}

/** Refunds recorded in one period (by the date each refund happened), summed exactly. */
export interface RefundBucket {
  period: string;
  refunds: Money;
}

export interface SalesPeriodView {
  period: string;
  /** Non-cancelled orders placed in the period. */
  orderCount: number;
  /** Their totals: what customers committed to pay, inclusive of shipping and tax, net of discounts. */
  grossSales: Money;
  /** Refunds that happened in the period, whatever period their order was placed in. */
  refunds: Money;
  /** `grossSales - refunds`. Negative in a period whose refunds exceed its sales. */
  revenue: Money;
  /** `grossSales / orderCount` — the value of an order placed in the period, unaffected by refunds of earlier orders. */
  averageOrderValue: Money;
}

export interface SalesSummary {
  granularity: SalesGranularity;
  from: string;
  to: string;
  periods: SalesPeriodView[];
  totals: Omit<SalesPeriodView, "period">;
}

/** Longest range a single request may cover — bounds the aggregation and the response. */
export const MAX_SALES_PERIODS: Record<SalesGranularity, number> = { day: 366, month: 36 };

/** Default range when the caller gives none: the last 30 days, or the last 12 months, ending today. */
const DEFAULT_SALES_PERIODS: Record<SalesGranularity, number> = { day: 30, month: 12 };

export interface SalesRange {
  /** Inclusive: the first instant of the first period, in the store's zone. */
  start: Date;
  /** Exclusive: the first instant after the last period, in the store's zone. */
  end: Date;
  from: string;
  to: string;
  periods: string[];
}

export class SalesRangeError extends Error {}

/**
 * Resolves the requested calendar range into instants and the full list of
 * period keys it covers.
 *
 * **Days and months are the store's, in `timeZone`** (the `STORE_TIMEZONE`
 * setting) — not the server's and not UTC. "Today" is today there; a day's
 * boundaries are its local midnights, including on a daylight-saving day
 * whose midnight is skipped. The same zone groups orders in the database
 * (`$dateToString`), so the range and the buckets cannot disagree.
 *
 * Pure: `now` and `timeZone` are passed in.
 */
export function resolveSalesRange(input: {
  granularity: SalesGranularity;
  from?: string;
  to?: string;
  now: Date;
  timeZone: string;
}): SalesRange {
  const { granularity, timeZone } = input;

  const toDay = input.to ? requireCalendarDate(input.to) : zonedDate(input.now, timeZone);
  const fromDay = input.from
    ? requireCalendarDate(input.from)
    : granularity === "day"
      ? addDays(toDay, -(DEFAULT_SALES_PERIODS.day - 1))
      : addMonths(toDay, -(DEFAULT_SALES_PERIODS.month - 1));

  if (fromDay > toDay) {
    throw new SalesRangeError("`from` must not be after `to`.");
  }

  const firstPeriod = granularity === "day" ? fromDay : startOfMonth(fromDay);
  const afterLastPeriod = granularity === "day" ? addDays(toDay, 1) : addMonths(toDay, 1);

  const periods: string[] = [];
  for (let cursor = firstPeriod; cursor < afterLastPeriod; cursor = granularity === "day" ? addDays(cursor, 1) : addMonths(cursor, 1)) {
    periods.push(granularity === "day" ? cursor : cursor.slice(0, 7));
    if (periods.length > MAX_SALES_PERIODS[granularity]) {
      throw new SalesRangeError(
        `A ${granularity} report covers at most ${MAX_SALES_PERIODS[granularity]} ${granularity === "day" ? "days" : "months"}.`
      );
    }
  }

  return {
    start: startOfZonedDate(firstPeriod, timeZone),
    end: startOfZonedDate(afterLastPeriod, timeZone),
    from: fromDay,
    to: toDay,
    periods,
  };
}

function requireCalendarDate(value: string): string {
  const date = parseCalendarDate(value);
  if (!date) throw new SalesRangeError(`"${value}" is not a real YYYY-MM-DD calendar date.`);
  return date;
}

/**
 * Turns the database's sparse buckets into one row per period in range —
 * a day with no orders and no refunds is a zero row, not a missing one,
 * because a gap in a daily chart reads as missing data rather than a quiet day.
 *
 * Revenue is net: an order counts in the period it was placed, and a refund
 * counts against the period it happened in — a 10,000 September order
 * refunded 2,000 in October is +10,000 in September and −2,000 in October.
 * Every amount arrives exact (summed as `Decimal128` in the database); the
 * average is the one derived amount, rounded once on the division.
 */
export function summarizeSales(input: {
  granularity: SalesGranularity;
  range: Pick<SalesRange, "from" | "to" | "periods">;
  orders: OrderBucket[];
  refunds: RefundBucket[];
}): SalesSummary {
  const ordersByPeriod = new Map(input.orders.map((bucket) => [bucket.period, bucket]));
  const refundsByPeriod = new Map(input.refunds.map((bucket) => [bucket.period, bucket.refunds]));

  const periods = input.range.periods.map((period) =>
    view(period, ordersByPeriod.get(period)?.orderCount ?? 0, ordersByPeriod.get(period)?.grossSales ?? ZERO, refundsByPeriod.get(period) ?? ZERO)
  );

  const { period: _period, ...totals } = view(
    "",
    periods.reduce((total, period) => total + period.orderCount, 0),
    sum(periods.map((period) => period.grossSales)),
    sum(periods.map((period) => period.refunds))
  );

  return { granularity: input.granularity, from: input.range.from, to: input.range.to, periods, totals };
}

function view(period: string, orderCount: number, grossSales: Money, refunds: Money): SalesPeriodView {
  return {
    period,
    orderCount,
    grossSales,
    refunds,
    revenue: grossSales.minus(refunds),
    averageOrderValue: orderCount === 0 ? ZERO : roundMoney(grossSales.div(orderCount)),
  };
}

/** The `$dateToString` format matching the period keys `resolveSalesRange` produces — kept beside it so the two cannot drift. */
export function periodFormat(granularity: SalesGranularity): string {
  return granularity === "day" ? "%Y-%m-%d" : "%Y-%m";
}
