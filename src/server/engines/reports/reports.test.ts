import { MONEY_SCALE, toMoney, type Money } from "@kira-joo/toolkit-common";
import { describe, expect, it } from "vitest";
import { MAX_SALES_PERIODS, SalesRangeError, resolveSalesRange, summarizeSales } from "./sales-summary";
import { agePaymentQueue } from "./payment-ageing";
import { assertTimeZone, startOfZonedDate, zonedDate } from "./zoned-calendar";
import { classifyStockHealth } from "./stock-health";

const m = (value: string) => toMoney(value);
const amount = (value: Money) => value.toFixed(MONEY_SCALE);

describe("resolveSalesRange", () => {
  const CAIRO = "Africa/Cairo";
  // 2 Oct 2026 15:30 in Cairo (UTC+3, summer time).
  const now = new Date("2026-10-02T12:30:00Z");

  it("defaults a daily report to the last 30 days ending today in the store's zone, inclusive", () => {
    const range = resolveSalesRange({ granularity: "day", now, timeZone: CAIRO });
    expect(range.from).toBe("2026-09-03");
    expect(range.to).toBe("2026-10-02");
    expect(range.periods).toHaveLength(30);
    expect(range.periods.at(-1)).toBe("2026-10-02");
  });

  it("takes 'today' from the store's zone, not the server's or UTC", () => {
    // 23:30 UTC on 1 Oct is already 2 Oct in Cairo, and still 1 Oct in New York.
    const lateUtc = new Date("2026-10-01T23:30:00Z");
    expect(resolveSalesRange({ granularity: "day", now: lateUtc, timeZone: CAIRO }).to).toBe("2026-10-02");
    expect(resolveSalesRange({ granularity: "day", now: lateUtc, timeZone: "America/New_York" }).to).toBe("2026-10-01");
  });

  it("bounds a day by the store's local midnights, end exclusive", () => {
    const range = resolveSalesRange({ granularity: "day", from: "2026-10-01", to: "2026-10-01", now, timeZone: CAIRO });
    expect(range.start.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-01T21:00:00.000Z");
    expect(range.periods).toEqual(["2026-10-01"]);

    const kolkata = resolveSalesRange({ granularity: "day", from: "2026-10-01", to: "2026-10-01", now, timeZone: "Asia/Kolkata" });
    expect(kolkata.start.toISOString()).toBe("2026-09-30T18:30:00.000Z"); // a half-hour offset
  });

  it("defaults a monthly report to the last 12 months including the current one, on local month starts", () => {
    const range = resolveSalesRange({ granularity: "month", now, timeZone: CAIRO });
    expect(range.periods).toHaveLength(12);
    expect(range.periods[0]).toBe("2025-11");
    expect(range.periods.at(-1)).toBe("2026-10");
    expect(range.start.toISOString()).toBe("2025-10-31T22:00:00.000Z"); // 1 Nov in Cairo, winter time (UTC+2)
    expect(range.end.toISOString()).toBe("2026-10-31T22:00:00.000Z"); // 1 Nov, after the October change back to UTC+2
  });

  it("widens a monthly range to whole months and crosses a year boundary", () => {
    expect(resolveSalesRange({ granularity: "month", from: "2026-01-15", to: "2026-03-02", now, timeZone: CAIRO }).periods).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(resolveSalesRange({ granularity: "month", from: "2025-12-01", to: "2026-01-31", now, timeZone: CAIRO }).periods).toEqual([
      "2025-12",
      "2026-01",
    ]);
  });

  it("rejects from after to, and a malformed or impossible date", () => {
    expect(() => resolveSalesRange({ granularity: "day", from: "2026-10-02", to: "2026-10-01", now, timeZone: CAIRO })).toThrow(SalesRangeError);
    expect(() => resolveSalesRange({ granularity: "day", from: "2026-1-01", now, timeZone: CAIRO })).toThrow(SalesRangeError);
    expect(() => resolveSalesRange({ granularity: "day", from: "2026-02-30", to: "2026-03-01", now, timeZone: CAIRO })).toThrow(SalesRangeError);
  });

  it("allows exactly the maximum span and rejects one period more", () => {
    expect(resolveSalesRange({ granularity: "day", from: "2025-01-01", to: "2026-01-01", now, timeZone: CAIRO }).periods).toHaveLength(MAX_SALES_PERIODS.day);
    expect(() => resolveSalesRange({ granularity: "day", from: "2025-01-01", to: "2026-01-02", now, timeZone: CAIRO })).toThrow(SalesRangeError);
    expect(() => resolveSalesRange({ granularity: "month", from: "2023-01-01", to: "2026-01-01", now, timeZone: CAIRO })).toThrow(SalesRangeError);
  });
});

describe("zoned calendar", () => {
  it("a daylight-saving day whose midnight is skipped begins at the jump", () => {
    // Cairo springs forward at 00:00 on the last Friday of April 2026 (24 Apr): 00:00 → 01:00.
    expect(startOfZonedDate("2026-04-24", "Africa/Cairo").toISOString()).toBe("2026-04-23T22:00:00.000Z");
    expect(zonedDate(new Date("2026-04-23T21:59:59.999Z"), "Africa/Cairo")).toBe("2026-04-23");
    expect(zonedDate(new Date("2026-04-23T22:00:00.000Z"), "Africa/Cairo")).toBe("2026-04-24");
  });

  it("the day after a fall-back change begins once, at the later offset", () => {
    // New York falls back on 1 Nov 2026 at 02:00; 2 Nov begins at 05:00 UTC (EST).
    expect(startOfZonedDate("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(startOfZonedDate("2026-11-02", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("UTC is the identity", () => {
    expect(startOfZonedDate("2026-10-01", "UTC").toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rejects an unknown zone", () => {
    expect(() => assertTimeZone("Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("summarizeSales", () => {
  const range = { from: "2026-10-01", to: "2026-10-03", periods: ["2026-10-01", "2026-10-02", "2026-10-03"] };
  const orders = (period: string, orderCount: number, grossSales: string) => ({ period, orderCount, grossSales: m(grossSales) });
  const refunds = (period: string, value: string) => ({ period, refunds: m(value) });

  it("fills a period with no orders and no refunds as a zero row rather than omitting it", () => {
    const summary = summarizeSales({ granularity: "day", range, orders: [orders("2026-10-01", 2, "300.00")], refunds: [] });
    expect(summary.periods.map((p) => p.period)).toEqual(range.periods);
    expect(summary.periods[1]).toMatchObject({ orderCount: 0 });
    expect([summary.periods[1].grossSales, summary.periods[1].refunds, summary.periods[1].revenue, summary.periods[1].averageOrderValue].map(amount)).toEqual([
      "0.00",
      "0.00",
      "0.00",
      "0.00",
    ]);
  });

  it("with no refunds, revenue equals gross sales", () => {
    const summary = summarizeSales({ granularity: "day", range, orders: [orders("2026-10-01", 2, "300.00")], refunds: [] });
    expect(amount(summary.periods[0].revenue)).toBe("300.00");
  });

  it("nets refunds against the period they happened in, which can go negative", () => {
    const summary = summarizeSales({
      granularity: "day",
      range,
      orders: [orders("2026-10-01", 1, "100.00")],
      refunds: [refunds("2026-10-01", "30.00"), refunds("2026-10-02", "50.00")],
    });
    expect(summary.periods.map((p) => amount(p.revenue))).toEqual(["70.00", "-50.00", "0.00"]);
    expect(amount(summary.totals.grossSales)).toBe("100.00");
    expect(amount(summary.totals.refunds)).toBe("80.00");
    expect(amount(summary.totals.revenue)).toBe("20.00");
  });

  it("averages gross sales per order placed — refunds of earlier orders do not move it", () => {
    const summary = summarizeSales({
      granularity: "day",
      range,
      orders: [orders("2026-10-02", 3, "100.00")],
      refunds: [refunds("2026-10-02", "90.00")],
    });
    expect(amount(summary.periods[1].averageOrderValue)).toBe("33.33");
  });

  it("totals are summed from exact period amounts, and the total average is not an average of averages", () => {
    const summary = summarizeSales({
      granularity: "day",
      range,
      orders: [orders("2026-10-01", 1, "0.10"), orders("2026-10-02", 3, "0.20")],
      refunds: [],
    });
    expect(amount(summary.totals.grossSales)).toBe("0.30");
    expect(summary.totals.orderCount).toBe(4);
    // 0.30 / 4 = 0.075 → 0.08; averaging the per-day averages (0.10, 0.07) would give 0.085 → 0.09.
    expect(amount(summary.totals.averageOrderValue)).toBe("0.08");
  });

  it("ignores buckets outside the requested periods", () => {
    const summary = summarizeSales({
      granularity: "day",
      range,
      orders: [orders("2026-09-30", 5, "50.00")],
      refunds: [refunds("2026-10-04", "10.00")],
    });
    expect(summary.totals.orderCount).toBe(0);
    expect(amount(summary.totals.refunds)).toBe("0.00");
  });
});

describe("agePaymentQueue", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const item = (orderNumber: string, hoursAgo: number) => ({
    orderId: orderNumber,
    orderNumber,
    method: "INSTAPAY",
    expectedAmount: m("100.00"),
    waitingSince: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000),
  });

  it("orders the queue oldest first and reports the oldest wait", () => {
    const report = agePaymentQueue([item("A", 2), item("B", 50), item("C", 30)], now);
    expect(report.items.map((i) => i.orderNumber)).toEqual(["B", "C", "A"]);
    expect(report.oldestWaitingHours).toBe(50);
    expect(report.count).toBe(3);
  });

  it("bands at exactly 24h and 48h, with floored hours — 47h59m is not two days", () => {
    const report = agePaymentQueue([item("A", 23.99), item("B", 24), item("C", 47.99), item("D", 48)], now);
    expect(report.items.map((i) => [i.orderNumber, i.band])).toEqual([
      ["D", "OVER_48H"],
      ["C", "24H_TO_48H"],
      ["B", "24H_TO_48H"],
      ["A", "UNDER_24H"],
    ]);
    expect(report.bands).toEqual([
      { band: "UNDER_24H", count: 1 },
      { band: "24H_TO_48H", count: 2 },
      { band: "OVER_48H", count: 1 },
    ]);
  });

  it("reports an empty queue as zero, with no oldest wait", () => {
    const report = agePaymentQueue([], now);
    expect(report.count).toBe(0);
    expect(report.oldestWaitingHours).toBeNull();
    expect(report.bands.every((b) => b.count === 0)).toBe(true);
  });

  it("never reports a negative wait for a clock-skewed submission time", () => {
    const report = agePaymentQueue([item("A", -1)], now);
    expect(report.items[0].waitingHours).toBe(0);
    expect(report.items[0].band).toBe("UNDER_24H");
  });
});

describe("classifyStockHealth", () => {
  it("zero or negative (backordered) stock is out of stock", () => {
    expect(classifyStockHealth(0, 5)).toBe("OUT_OF_STOCK");
    expect(classifyStockHealth(-3, 5)).toBe("OUT_OF_STOCK");
  });

  it("stock at the threshold is low, one above it is healthy", () => {
    expect(classifyStockHealth(5, 5)).toBe("LOW_STOCK");
    expect(classifyStockHealth(6, 5)).toBe("HEALTHY");
  });

  it("a zero threshold never calls positive stock low", () => {
    expect(classifyStockHealth(1, 0)).toBe("HEALTHY");
  });
});
