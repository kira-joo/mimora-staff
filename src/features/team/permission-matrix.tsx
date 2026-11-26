"use client";

import { Check, Minus } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { buildMatrix, cellState, MATRIX_COLUMNS, rowKeys, toggleKeys, type CellState, type MatrixPermission, type MatrixRow } from "./permission-matrix-model";

export interface PermissionMatrixProps {
  permissions: readonly MatrixPermission[];
  /** The keys currently granted. */
  value: ReadonlySet<string>;
  /** Absent → read-only. */
  onChange?: (next: Set<string>) => void;
  /** Whether the person editing may grant a key. A key they can't grant is disabled — the server refuses it anyway. */
  canGrant?: (key: string) => boolean;
  disabled?: boolean;
}

/**
 * Modules × View / Create / Edit / Delete, plus each module's own special actions ("Verify payment"). On a phone each
 * module becomes a block of labelled checkboxes; from `md` up it is a real grid with column headers. Every control is
 * a native checkbox with its own accessible name ("Products: Edit"), so it works by keyboard and screen reader.
 */
export function PermissionMatrix({ permissions, value, onChange, canGrant = () => true, disabled }: PermissionMatrixProps) {
  const sections = useMemo(() => buildMatrix(permissions), [permissions]);
  const readOnly = !onChange;

  if (sections.length === 0) return <p className="text-[var(--st-ink-muted)]">No permissions to show.</p>;

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => {
        const keys = section.rows.flatMap(rowKeys);
        const grantable = keys.filter(canGrant);
        const state = cellState(keys, value);
        return (
          <section key={section.label} aria-label={section.label} className="border border-[var(--st-line)] bg-[var(--st-surface)]">
            <header className="flex min-h-[var(--st-tap-min)] flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--st-line)] px-4 py-2">
              <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--st-ink-muted)]">{section.label}</h3>
              {readOnly ? null : (
                <button
                  type="button"
                  disabled={disabled || grantable.length === 0}
                  onClick={() => onChange(toggleKeys(value, grantable, state !== "on"))}
                  className="ms-auto min-h-[var(--st-tap-min)] px-2 text-[13px] font-medium text-[var(--st-accent)] underline-offset-2 hover:underline disabled:text-[var(--st-ink-muted)] disabled:no-underline"
                >
                  {state === "on" ? `Clear ${section.label}` : `Select all ${section.label}`}
                </button>
              )}
            </header>
            <div role="table" aria-label={`${section.label} permissions`} className="flex flex-col">
              <div role="row" className="hidden border-b border-[var(--st-line)] px-4 py-2 text-[13px] font-medium text-[var(--st-ink-muted)] md:grid md:grid-cols-[minmax(140px,1.2fr)_repeat(4,72px)_minmax(0,2fr)] md:gap-x-2">
                <span role="columnheader">Module</span>
                {MATRIX_COLUMNS.map((column) => (
                  <span role="columnheader" key={column.column} className="text-center">
                    {column.label}
                  </span>
                ))}
                <span role="columnheader">Other actions</span>
              </div>
              {section.rows.map((row) => (
                <MatrixRowView key={row.entity} row={row} value={value} onChange={onChange} canGrant={canGrant} disabled={disabled} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MatrixRowView({ row, value, onChange, canGrant, disabled }: { row: MatrixRow; value: ReadonlySet<string>; onChange?: (next: Set<string>) => void; canGrant: (key: string) => boolean; disabled?: boolean }) {
  return (
    <div role="row" className="flex flex-col gap-1 border-b border-[var(--st-line)] px-4 py-2 last:border-b-0 md:grid md:grid-cols-[minmax(140px,1.2fr)_repeat(4,72px)_minmax(0,2fr)] md:items-center md:gap-x-2">
      <span role="rowheader" className="py-1 font-medium">
        {row.label}
      </span>
      <div className="flex flex-wrap gap-x-1 md:contents">
        {MATRIX_COLUMNS.map((column) => {
          const keys = row.columns[column.column];
          return (
            <span role="cell" key={column.column} className="md:flex md:justify-center">
              {keys.length === 0 ? (
                <span className="hidden text-[var(--st-ink-muted)] md:inline" aria-label={`${row.label}: ${column.label} not applicable`}>
                  —
                </span>
              ) : (
                <MatrixCheckbox
                  label={column.label}
                  accessibleName={`${row.label}: ${column.label}`}
                  hideLabelFrom="md"
                  state={cellState(keys, value)}
                  onToggle={onChange ? (on) => onChange(toggleKeys(value, keys, on)) : undefined}
                  disabled={disabled || keys.some((key) => !canGrant(key) && !value.has(key))}
                />
              )}
            </span>
          );
        })}
        <span role="cell" className="flex flex-wrap gap-x-1 md:col-auto">
          {row.special.map((entry) => (
            <MatrixCheckbox
              key={entry.key}
              label={entry.label}
              accessibleName={`${row.label}: ${entry.label}`}
              state={value.has(entry.key) ? "on" : "off"}
              onToggle={onChange ? (on) => onChange(toggleKeys(value, [entry.key], on)) : undefined}
              disabled={disabled || (!canGrant(entry.key) && !value.has(entry.key))}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function MatrixCheckbox({
  label,
  accessibleName,
  state,
  onToggle,
  disabled,
  hideLabelFrom,
}: {
  label: string;
  accessibleName: string;
  state: CellState;
  onToggle?: (on: boolean) => void;
  disabled?: boolean;
  hideLabelFrom?: "md";
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "partial";
  }, [state]);

  const labelClass = hideLabelFrom === "md" ? "md:sr-only" : "";

  if (!onToggle) {
    // Read-only: an icon and text, never colour alone.
    if (state === "off") return null;
    const Icon = state === "on" ? Check : Minus;
    return (
      <span className="inline-flex min-h-8 items-center gap-1.5 pe-2 text-[13px]" aria-label={`${accessibleName}: ${state === "on" ? "allowed" : "partly allowed"}`}>
        <Icon aria-hidden="true" className="size-4 shrink-0 text-[var(--st-status-done)]" strokeWidth={2.5} />
        <span className={labelClass}>{label}</span>
      </span>
    );
  }

  return (
    <label
      className={`inline-flex min-h-[var(--st-tap-min)] min-w-[var(--st-tap-min)] cursor-pointer items-center gap-2 pe-2 text-[14px] ${disabled ? "cursor-not-allowed opacity-50" : ""} md:justify-center md:pe-0`}
      title={disabled && state === "off" ? "You can only grant permissions you have yourself." : undefined}
    >
      <input
        ref={ref}
        type="checkbox"
        aria-label={accessibleName}
        checked={state === "on"}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked)}
        className="size-[18px] shrink-0 accent-[var(--st-accent)]"
      />
      <span className={labelClass} aria-hidden="true">
        {label}
      </span>
    </label>
  );
}
