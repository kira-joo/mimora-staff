"use client";

/** Sunday first, matching `FulfilmentSettings.shippingDays` (0 = Sunday … 6 = Saturday). */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * The weekdays orders ship on, as a row of labelled checkboxes. Kept apart from the store's opening hours on
 * purpose: these only change how delivery estimates count days, never what the storefront shows as open.
 */
export function ShippingDaysField({ value, onChange, disabled }: { value: number[]; onChange(next: number[]): void; disabled?: boolean }) {
  const toggle = (day: number, on: boolean) => onChange(on ? [...value, day].sort((a, b) => a - b) : value.filter((candidate) => candidate !== day));
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="text-sm font-medium text-[var(--st-ink)]">Shipping days</legend>
      <p className="text-sm text-[var(--st-ink-muted)]">
        The days orders are shipped. Delivery estimates count only these days, and an order placed on another day (or after the daily cutoff) starts counting from the next one. This does not change the store hours customers see. With none ticked, estimates count every calendar day.
      </p>
      <div className="flex flex-wrap gap-x-5">
        {WEEKDAYS.map((name, day) => (
          <label key={name} className="flex min-h-11 items-center gap-2 text-[var(--st-ink)]">
            <input type="checkbox" className="size-4" checked={value.includes(day)} disabled={disabled} onChange={(event) => toggle(day, event.target.checked)} />
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
