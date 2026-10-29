import { PAYMENT_AGEING_BANDS, type PaymentAgeingBand } from "src/server/engines/reports/payment-ageing";
import type { StatusTone } from "src/features/status/status-vocabulary";

/** Each ageing band's tone: fresh is neutral, a day old is pending, two days is overdue. */
export const BAND_TONE: Record<PaymentAgeingBand, StatusTone> = { UNDER_24H: "neutral", "24H_TO_48H": "pending", OVER_48H: "danger" };

export const BAND_LABEL: Record<PaymentAgeingBand, string> = { UNDER_24H: "Under 24 hours", "24H_TO_48H": "24–48 hours", OVER_48H: "Over 48 hours" };

/** A wait in words: hours up to two days, then days. */
export const waitLabel = (hours: number): string => (hours < 1 ? "Under an hour" : hours < 48 ? `${Math.floor(hours)} h` : `${Math.floor(hours / 24)} days`);

/**
 * How long a payment has waited for review, in the bands the payment-ageing
 * report uses (its own exported constant — one definition of "stale").
 * Display only: nothing here decides anything.
 */
export function ageOf(since: string, now: Date): { hours: number; band: PaymentAgeingBand; tone: StatusTone; label: string } {
  const hours = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 3_600_000));
  const band = PAYMENT_AGEING_BANDS.find(({ maxHours }) => hours < maxHours)!.band;
  return { hours, band, tone: BAND_TONE[band], label: waitLabel(hours) };
}
