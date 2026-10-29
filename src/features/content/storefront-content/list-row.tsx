"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useFormState, type Control, type FieldValues, type Path } from "react-hook-form";

interface ListRowProps {
  title: ReactNode;
  disabled?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  /** Accessible noun for the move/remove buttons, e.g. "section 3". */
  name: string;
  children: ReactNode;
}

/** One ordered row: a titled frame with Move up / Move down / Remove (no drag — keyboard and touch reach everything). */
export function ListRow({ title, disabled, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onRemove, name, children }: ListRowProps) {
  return (
    <li className="flex flex-col gap-4 border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* A floor on the title wraps the row actions underneath on a phone instead of truncating the title to "1…". */}
        <span className="min-w-[10rem] flex-1 break-words font-medium text-[var(--st-ink)]" dir="auto">
          {title}
        </span>
        {disabled ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <CustomButton type="button" variant="ghost" className="min-h-11 min-w-11" disabled={!canMoveUp} onClick={onMoveUp} aria-label={`Move ${name} up`}>
              <ArrowUp aria-hidden="true" className="size-4" />
            </CustomButton>
            <CustomButton type="button" variant="ghost" className="min-h-11 min-w-11" disabled={!canMoveDown} onClick={onMoveDown} aria-label={`Move ${name} down`}>
              <ArrowDown aria-hidden="true" className="size-4" />
            </CustomButton>
            <CustomButton type="button" variant="ghost" className="min-h-11 text-[var(--st-status-danger)]" onClick={onRemove} aria-label={`Remove ${name}`}>
              <Trash2 aria-hidden="true" className="size-4" />
              Remove
            </CustomButton>
          </div>
        )}
      </div>
      {children}
    </li>
  );
}

/** A server or client error that belongs to the row itself rather than any one input (e.g. "the hero can only be first"). */
export function RowError<T extends FieldValues>({ control, name }: { control: Control<T>; name: Path<T> }) {
  const { errors } = useFormState({ control, name });
  const message = name.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], errors) as { message?: string } | undefined;
  return message?.message ? (
    <p role="alert" className="text-sm font-medium text-[var(--st-status-danger)]">
      {message.message}
    </p>
  ) : null;
}
