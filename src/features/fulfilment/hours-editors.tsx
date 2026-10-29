"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomSwitch } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { Plus, Trash2 } from "lucide-react";
import type { HourRange, HoursException, WeeklyHours } from "src/api/fulfilment-settings.endpoints";
import { WEEKDAYS } from "./fulfilment-values";

const DEFAULT_RANGE: HourRange = { open: "09:00", close: "17:00" };

const FIELD_CLASS =
  "st-figure h-11 min-w-0 rounded-md border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-3 text-[var(--st-ink)] disabled:opacity-60";

/** One day's opening ranges: native time pickers (24-hour value `HH:mm`), add and remove. */
function RangesEditor({ ranges, onChange, subject }: { ranges: HourRange[]; onChange: (next: HourRange[]) => void; subject: string }) {
  const update = (index: number, patch: Partial<HourRange>) => onChange(ranges.map((range, i) => (i === index ? { ...range, ...patch } : range)));
  return (
    <div className="flex flex-col gap-2">
      {ranges.map((range, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="time"
              dir="ltr"
              aria-label={`${subject}: opens${ranges.length > 1 ? `, range ${index + 1}` : ""}`}
              className={FIELD_CLASS}
              value={range.open}
              onChange={(event) => update(index, { open: event.target.value })}
            />
            <span aria-hidden="true" className="hidden text-[var(--st-ink-muted)] sm:inline">
              to
            </span>
            <input
              type="time"
              dir="ltr"
              aria-label={`${subject}: closes${ranges.length > 1 ? `, range ${index + 1}` : ""}`}
              className={FIELD_CLASS}
              value={range.close}
              onChange={(event) => update(index, { close: event.target.value })}
            />
          </div>
          <CustomButton type="button" variant="ghost" size="icon" aria-label={`Remove range ${index + 1} for ${subject}`} onClick={() => onChange(ranges.filter((_, i) => i !== index))}>
            <Trash2 className="size-4" aria-hidden="true" />
          </CustomButton>
        </div>
      ))}
      <div>
        <CustomButton type="button" variant="ghost" leftIcon={Plus} onClick={() => onChange([...ranges, { ...DEFAULT_RANGE }])}>
          Add hours
        </CustomButton>
      </div>
    </div>
  );
}

/** Seven rows, Sunday first (the API's weekday 0). A day with no ranges is closed. */
export function WeekEditor({ value, onChange }: { value: WeeklyHours[]; onChange: (next: WeeklyHours[]) => void }) {
  const setRanges = (weekday: number, ranges: HourRange[]) => onChange(value.map((day) => (day.weekday === weekday ? { ...day, ranges } : day)));
  return (
    <ul className="flex flex-col divide-y divide-[var(--st-line)] border border-[var(--st-line)] bg-[var(--st-surface)]">
      {value.map((day) => {
        const name = WEEKDAYS[day.weekday];
        const open = day.ranges.length > 0;
        return (
          <li key={day.weekday} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-6">
            <div className="sm:w-48 sm:shrink-0">
              <CustomSwitch
                label={name}
                description={open ? undefined : "Closed"}
                checked={open}
                onChange={(next) => setRanges(day.weekday, next ? [{ ...DEFAULT_RANGE }] : [])}
              />
            </div>
            {open ? <RangesEditor ranges={day.ranges} subject={name} onChange={(ranges) => setRanges(day.weekday, ranges)} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Dated overrides of the weekly schedule — a holiday, a one-off closure. */
export function ExceptionsEditor({ value, onChange }: { value: HoursException[]; onChange: (next: HoursException[]) => void }) {
  const update = (index: number, patch: Partial<HoursException>) => onChange(value.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? <p className="text-[var(--st-ink-muted)]">No exceptions. The weekly hours apply every day.</p> : null}
      {value.map((exception, index) => {
        const subject = exception.date ? `exception ${exception.date}` : `exception ${index + 1}`;
        return (
          <div key={index} className="flex flex-col gap-3 border border-[var(--st-line)] bg-[var(--st-surface)] p-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="date"
                dir="ltr"
                aria-label={`Date of exception ${index + 1}`}
                className={FIELD_CLASS}
                value={exception.date}
                onChange={(event) => update(index, { date: event.target.value })}
              />
              <div className="min-w-0 flex-1">
                <CustomSwitch
                  label="Closed all day"
                  checked={exception.closed}
                  onChange={(closed) => update(index, { closed, ranges: closed ? [] : exception.ranges.length > 0 ? exception.ranges : [{ ...DEFAULT_RANGE }] })}
                />
              </div>
              <CustomButton type="button" variant="ghost" size="icon" aria-label={`Remove ${subject}`} onClick={() => onChange(value.filter((_, i) => i !== index))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </CustomButton>
            </div>
            {exception.closed ? null : <RangesEditor ranges={exception.ranges} subject={subject} onChange={(ranges) => update(index, { ranges })} />}
          </div>
        );
      })}
      <div>
        <CustomButton type="button" variant="outline" leftIcon={Plus} disabled={value.length >= 200} onClick={() => onChange([...value, { date: "", closed: true, ranges: [] }])}>
          Add exception
        </CustomButton>
      </div>
    </div>
  );
}
