import type { Money } from "@kira-joo/toolkit-common";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The ageing bands, oldest last. MDS §15a: "a queue of 3 that has waited
 * two days is worse than a queue of 20 from this morning" — so the cut
 * points are one and two days, the line between "today's work" and "money
 * that has been sitting".
 */
export const PAYMENT_AGEING_BANDS = [
  { band: "UNDER_24H", maxHours: 24 },
  { band: "24H_TO_48H", maxHours: 48 },
  { band: "OVER_48H", maxHours: Number.POSITIVE_INFINITY },
] as const;

export type PaymentAgeingBand = (typeof PAYMENT_AGEING_BANDS)[number]["band"];

export interface AwaitingPayment {
  orderId: string;
  orderNumber: string;
  method: string;
  expectedAmount: Money;
  /** When the payment entered review — the proof's submission time. */
  waitingSince: Date;
}

export interface AgedPayment extends AwaitingPayment {
  waitingHours: number;
  band: PaymentAgeingBand;
}

export interface PaymentAgeingReport {
  asOf: Date;
  count: number;
  oldestWaitingHours: number | null;
  bands: Array<{ band: PaymentAgeingBand; count: number }>;
  /** Oldest first — the order a reviewer should work them in. */
  items: AgedPayment[];
}

/**
 * Pure: `now` is passed in. Waiting time is whole elapsed hours, floored —
 * "waited 47 hours" must not read as two days.
 */
export function agePaymentQueue(items: AwaitingPayment[], now: Date): PaymentAgeingReport {
  const aged = items
    .map((item) => {
      const waitingHours = Math.max(0, Math.floor((now.getTime() - item.waitingSince.getTime()) / HOUR_MS));
      return { ...item, waitingHours, band: bandFor(waitingHours) };
    })
    .sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime());

  return {
    asOf: now,
    count: aged.length,
    oldestWaitingHours: aged[0]?.waitingHours ?? null,
    bands: PAYMENT_AGEING_BANDS.map(({ band }) => ({ band, count: aged.filter((item) => item.band === band).length })),
    items: aged,
  };
}

function bandFor(waitingHours: number): PaymentAgeingBand {
  return PAYMENT_AGEING_BANDS.find(({ maxHours }) => waitingHours < maxHours)!.band;
}
