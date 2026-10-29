"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { Plus, Trash2 } from "lucide-react";
import type { OptionAxis, OptionAxisValue } from "src/api/products.endpoints";
import { displayName } from "../catalog-display";
import { LocalizedPair } from "./localized-pair";
import { newAxis, newAxisValue, suggestKey } from "./product-options";

/**
 * The product's selling options (size, colour). The key follows the English
 * name until staff edit it themselves; variants store their values against it,
 * so once the product has variants the keys are fixed (MDS §13 — the API
 * refuses a change): names stay editable, keys and the set of options do not.
 */
export function OptionAxesEditor({
  value,
  onChange,
  error,
  disabled,
  variantCount,
}: {
  value: OptionAxis[];
  onChange: (axes: OptionAxis[]) => void;
  error?: string;
  disabled?: boolean;
  variantCount: number;
}) {
  const keysLocked = variantCount > 0;
  const update = (index: number, next: OptionAxis) => onChange(value.map((axis, i) => (i === index ? next : axis)));

  return (
    <div className="flex flex-col gap-3">
      {variantCount > 0 ? (
        <p className="rounded-md border border-[var(--st-line)] bg-[var(--st-canvas)] px-3 py-2 text-[13px] text-[var(--st-ink)]">
          This product has {variantCount} {variantCount === 1 ? "variant" : "variants"}, so its options are fixed: you can rename them, but not add, remove or re-key one.
          To change them, delete the variants first.
        </p>
      ) : null}
      {value.length === 0 ? <p className="text-[var(--st-ink-muted)]">No options — the product sells as a single variant.</p> : null}
      <ul className="flex flex-col gap-3">
        {value.map((axis, index) => {
          const name = displayName(axis.name) || `option ${index + 1}`;
          return (
            <li key={index} className="flex flex-col gap-3 rounded-md border border-[var(--st-line)] p-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <LocalizedPair
                label="Option name"
                value={axis.name}
                disabled={disabled}
                onChange={(next) => {
                  // With variants the key is fixed; only the name changes.
                  const followsName = keysLocked ? false : axis.key === suggestKey(axis.name.en);
                  update(index, { name: next, key: followsName ? suggestKey(next.en) : axis.key });
                }}
              />
              <CustomInput label="Key" className="st-figure" value={axis.key} maxLength={50} disabled={disabled || keysLocked} onChange={(event) => update(index, { ...axis, key: event.target.value })} />
              <CustomButton type="button" variant="ghost" size="icon" aria-label={`Remove ${name}`} disabled={disabled || keysLocked} onClick={() => onChange(value.filter((_, i) => i !== index))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </CustomButton>
              </div>
              <AxisValues axis={axis} name={name} disabled={disabled} onChange={(values) => update(index, { ...axis, values })} />
            </li>
          );
        })}
      </ul>
      <div>
        <CustomButton type="button" variant="outline" leftIcon={Plus} disabled={disabled || keysLocked} onClick={() => onChange([...value, newAxis()])}>
          Add option
        </CustomButton>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The values an option offers — "red", "blue" — each labelled for both languages, with an optional swatch. These are what
 * the variant matrix lays out and what a customer picks between. A value's key is what variants store, so it is fixed once
 * a variant uses it; the label and swatch stay editable. Adding a value never touches existing variants.
 */
function AxisValues({ axis, name, disabled, onChange }: { axis: OptionAxis; name: string; disabled?: boolean; onChange: (values: OptionAxisValue[]) => void }) {
  const values = axis.values ?? [];
  const update = (index: number, next: OptionAxisValue) => onChange(values.map((value, i) => (i === index ? next : value)));

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--st-line)] pt-3">
      <p className="font-medium text-[var(--st-ink)]">Values for {name}</p>
      {values.length === 0 ? <p className="text-[13px] text-[var(--st-ink-muted)]">No values listed yet. Add the values this option offers, and the variant matrix will lay out every combination.</p> : null}
      <ul className="flex flex-col gap-2">
        {values.map((value, index) => (
          <li key={index} className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-end">
            <CustomInput
              label={`${name} value key`}
              className="st-figure"
              value={value.key}
              maxLength={50}
              disabled={disabled}
              onChange={(event) => {
                const key = event.target.value;
                // The label follows the key until staff write their own, as the option's key follows its name.
                const followsKey = !value.label.en || value.label.en === value.key;
                update(index, { ...value, key, label: followsKey ? { ...value.label, en: key } : value.label });
              }}
            />
            <CustomInput label="Label (English)" dir="auto" value={value.label.en} disabled={disabled} onChange={(event) => update(index, { ...value, label: { ...value.label, en: event.target.value } })} />
            <CustomInput label="Label (Arabic)" dir="rtl" lang="ar" value={value.label.ar} disabled={disabled} onChange={(event) => update(index, { ...value, label: { ...value.label, ar: event.target.value } })} />
            <label className="flex flex-col gap-1 text-[13px] text-[var(--st-ink-muted)]">
              Swatch
              <input
                type="color"
                aria-label={`Swatch for ${value.key || "new value"}`}
                className="h-10 w-12 cursor-pointer rounded border border-[var(--st-line)] bg-transparent p-0.5"
                value={value.swatch ?? "#ffffff"}
                disabled={disabled}
                onChange={(event) => update(index, { ...value, swatch: event.target.value })}
              />
            </label>
            <CustomButton type="button" variant="ghost" size="icon" aria-label={`Remove value ${value.key || index + 1} from ${name}`} disabled={disabled} onClick={() => onChange(values.filter((_, i) => i !== index))}>
              <Trash2 className="size-4" aria-hidden="true" />
            </CustomButton>
          </li>
        ))}
      </ul>
      <div>
        <CustomButton type="button" variant="outline" leftIcon={Plus} disabled={disabled} onClick={() => onChange([...values, newAxisValue()])}>
          Add value
        </CustomButton>
      </div>
    </div>
  );
}
