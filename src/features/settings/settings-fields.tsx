"use client";

import { FieldType, type FormFieldConfig, type SimpleValidationRules } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { Info, Plus, Trash2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { FieldValues, Path } from "react-hook-form";

/** Shown to a role that may read a screen but not change it. The fields underneath are disabled and there is no save button. */
export function ReadOnlyNotice() {
  return (
    <p role="status" className="mb-4 flex items-start gap-2 border border-[var(--st-line)] bg-[var(--st-surface)] p-3 text-[var(--st-ink-muted)]">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>You can view these settings, but your role can&apos;t change them.</span>
    </p>
  );
}

/** A quiet note under a section or screen: facts the owner needs that aren't a field. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return <p className="text-[var(--st-ink-muted)]">{children}</p>;
}

interface TextFieldOptions {
  name: string;
  label: string;
  description?: string;
  /** `auto` for content that may be Arabic, Latin or both; `ltr` for numbers, codes, emails, URLs. Never left to inherit. */
  dir: "auto" | "ltr";
  /** Mono tabular figures: codes and numbers only, never Arabic. */
  figure?: boolean;
  rules?: SimpleValidationRules;
  disabled?: boolean;
  type?: ComponentProps<typeof CustomInput>["type"];
  inputMode?: ComponentProps<typeof CustomInput>["inputMode"];
  maxLength?: number;
  placeholder?: string;
  autoComplete?: string;
}

/**
 * A plain text input that, unlike the toolkit's INPUT field, sets `dir` — so Arabic content, an IBAN or a phone
 * number each read correctly. It is a CUSTOM field only so it can carry the attribute; validation and server
 * errors work exactly as for any other field.
 */
export function textField<T extends FieldValues>(o: TextFieldOptions): FormFieldConfig<T> {
  return {
    type: FieldType.CUSTOM,
    name: o.name as Path<T>,
    label: o.label,
    rules: o.rules,
    render: ({ field, error }) => (
      <CustomInput
        ref={field.ref}
        name={field.name}
        label={o.label}
        description={o.description}
        required={Boolean(o.rules?.required)}
        error={error}
        value={(field.value as string | undefined) ?? ""}
        onChange={(event) => field.onChange(event.target.value)}
        onBlur={field.onBlur}
        disabled={o.disabled}
        type={o.type}
        inputMode={o.inputMode}
        maxLength={o.maxLength}
        placeholder={o.placeholder}
        autoComplete={o.autoComplete ?? "off"}
        dir={o.dir}
        className={o.figure ? "st-figure" : undefined}
      />
    ),
  };
}

/** One repeated record in an array field (a payment method, a social link…): a titled frame with its own remove control. */
export function RowFrame({ title, onRemove, disabled, children }: { title: ReactNode; onRemove: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border border-[var(--st-line)] bg-[var(--st-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-medium text-[var(--st-ink)]" dir="auto">
          {title}
        </span>
        {disabled ? null : (
          <CustomButton type="button" variant="ghost" onClick={onRemove} className="shrink-0 text-[var(--st-status-danger)]">
            <Trash2 aria-hidden="true" className="size-4" />
            Remove
          </CustomButton>
        )}
      </div>
      {children}
    </div>
  );
}

export function AddRowButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <CustomButton type="button" variant="outline" onClick={onClick} disabled={disabled} className="self-start">
      <Plus aria-hidden="true" className="size-4" />
      {children}
    </CustomButton>
  );
}

