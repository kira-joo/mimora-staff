"use client";

import { useId } from "react";
import { useStoreFormat } from "src/common/format/store-format";
import { instantToWall, wallToInstant } from "./store-wall-clock";

/**
 * A date and time read on the STORE's clock (the same zone every date in this console is shown in),
 * stored as an ISO instant. The browser's own zone never enters into it. A native control, because the
 * toolkit's date picker converts through its own display zone, which this app does not configure.
 */
export function StoreDateTimeInput({
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const { dateTime } = useStoreFormat();
  const id = useId();
  const format = (iso: string) => dateTime(iso);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label} <span className="font-normal text-[var(--st-ink-muted)]">(store time)</span>
      </label>
      <input
        id={id}
        type="datetime-local"
        value={instantToWall(value || undefined, format)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(wallToInstant(event.target.value, format))}
        className="st-figure min-h-11 w-full rounded-md border border-[var(--st-line)] bg-[var(--st-surface,transparent)] px-3 text-[var(--st-ink)] disabled:opacity-60"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
