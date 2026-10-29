"use client";

import { FieldType, type CustomFieldConfig } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { CustomInput, CustomTextarea } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import type { FieldValues, Path } from "react-hook-form";
import { useState, type InputHTMLAttributes } from "react";
import { MONEY_INPUT_MESSAGE, isMoneyInput } from "src/common/format/money-input";
import { WHOLE_NUMBER_PATTERN, areasToText, parseAreas } from "./fulfilment-values";

interface InputFieldOptions<T extends FieldValues> {
  name: Path<T>;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  dir?: "ltr" | "rtl" | "auto";
  type?: "text" | "tel" | "number";
  rules?: CustomFieldConfig<T>["rules"];
}

/**
 * A text-like field with the one thing the toolkit's INPUT field cannot carry:
 * `inputMode` (decimal keyboards for money) and `dir` (LTR for phone numbers,
 * auto for content). Still a CustomForm field — validation, server errors and
 * the dirty guard work as for any other.
 */
export function inputField<T extends FieldValues>({ name, label, description, placeholder, required, inputMode, dir, type, rules }: InputFieldOptions<T>): CustomFieldConfig<T> {
  return {
    type: FieldType.CUSTOM,
    name,
    rules: { ...(required ? { required: `${label} is required.` } : {}), ...rules },
    render: ({ field, error }) => (
      <CustomInput
        ref={field.ref}
        name={field.name}
        label={label}
        required={required}
        description={description}
        placeholder={placeholder}
        inputMode={inputMode}
        dir={dir}
        type={type}
        autoComplete="off"
        value={(field.value as string | number | undefined) ?? ""}
        onChange={(event) => field.onChange(event.target.value)}
        onBlur={field.onBlur}
        error={error}
      />
    ),
  };
}

/** Money as a decimal string, validated with the server's own pattern — never parsed to a number. */
export function moneyField<T extends FieldValues>(options: Omit<InputFieldOptions<T>, "inputMode" | "dir" | "type" | "rules"> & { allowBlank?: boolean }): CustomFieldConfig<T> {
  const { allowBlank, ...rest } = options;
  return inputField<T>({
    ...rest,
    inputMode: "decimal",
    dir: "ltr",
    placeholder: rest.placeholder ?? "0.00",
    rules: { validate: (value) => ((allowBlank && (value === "" || value === undefined || value === null)) || isMoneyInput(String(value ?? "")) ? true : MONEY_INPUT_MESSAGE) },
  });
}

/** A whole number ≥ `min`, matching the DTOs' `@IsInt() @Min(min)`. */
export function wholeNumberField<T extends FieldValues>(options: Omit<InputFieldOptions<T>, "inputMode" | "dir" | "type" | "rules"> & { min?: number; allowBlank?: boolean }): CustomFieldConfig<T> {
  const { min = 0, allowBlank, ...rest } = options;
  return inputField<T>({
    ...rest,
    inputMode: "numeric",
    dir: "ltr",
    rules: {
      validate: (value) => {
        const text = String(value ?? "").trim();
        if (text === "" && allowBlank) return true;
        if (!WHOLE_NUMBER_PATTERN.test(text)) return `Enter a whole number, ${min} or more.`;
        return Number(text) >= min ? true : `Must be ${min} or more.`;
      },
    },
  });
}

/** A list of names, one per line — the toolkit has no array-of-strings field. The form value stays a real `string[]`. */
export function linesField<T extends FieldValues>({ name, label, description, placeholder, rows = 6 }: { name: Path<T>; label: string; description?: string; placeholder?: string; rows?: number }): CustomFieldConfig<T> {
  return {
    type: FieldType.CUSTOM,
    name,
    colSpan: "full",
    render: ({ field, error }) => <LinesTextarea label={label} description={description} placeholder={placeholder} rows={rows} value={field.value as string[] | undefined} onChange={field.onChange} error={error} />,
  };
}

/** The text is kept raw while typing — a trailing newline must survive until the next line is typed — and parsed on every change. */
function LinesTextarea({ label, description, placeholder, rows, value, onChange, error }: { label: string; description?: string; placeholder?: string; rows: number; value: string[] | undefined; onChange: (next: string[]) => void; error?: string }) {
  const [text, setText] = useState(() => areasToText(value));
  return (
    <CustomTextarea
      label={label}
      description={description}
      placeholder={placeholder}
      rows={rows}
      dir="auto"
      value={text}
      error={error}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseAreas(event.target.value));
      }}
    />
  );
}
