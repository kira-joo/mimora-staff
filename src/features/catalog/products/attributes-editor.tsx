"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { Plus, Trash2, X } from "lucide-react";
import type { ProductAttribute } from "src/api/products.endpoints";
import { displayName } from "../catalog-display";
import { LocalizedPair } from "./localized-pair";
import { newAttribute, suggestKey } from "./product-options";

type AttributeValue = ProductAttribute["values"][number];

/** Browsing facets (material, fit), each with its values. Not used to build variants. */
export function AttributesEditor({ value, onChange, error, disabled }: { value: ProductAttribute[]; onChange: (attributes: ProductAttribute[]) => void; error?: string; disabled?: boolean }) {
  const update = (index: number, next: ProductAttribute) => onChange(value.map((attribute, i) => (i === index ? next : attribute)));

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? <p className="text-[var(--st-ink-muted)]">No attributes.</p> : null}
      <ul className="flex flex-col gap-3">
        {value.map((attribute, index) => {
          const name = displayName(attribute.name) || `attribute ${index + 1}`;
          const setValue = (valueIndex: number, next: AttributeValue) => update(index, { ...attribute, values: attribute.values.map((v, i) => (i === valueIndex ? next : v)) });
          return (
            <li key={index} className="flex flex-col gap-3 rounded-md border border-[var(--st-line)] p-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <LocalizedPair
                  label="Attribute"
                  value={attribute.name}
                  disabled={disabled}
                  onChange={(next) => update(index, { ...attribute, name: next, key: attribute.key === suggestKey(attribute.name.en) ? suggestKey(next.en) : attribute.key })}
                />
                <CustomInput label="Key" className="st-figure" value={attribute.key} maxLength={50} disabled={disabled} onChange={(event) => update(index, { ...attribute, key: event.target.value })} />
                <CustomButton type="button" variant="ghost" size="icon" aria-label={`Remove ${name}`} disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </CustomButton>
              </div>
              <fieldset className="flex flex-col gap-2 border-s-2 border-[var(--st-line)] ps-3">
                <legend className="mb-1 text-[13px] font-medium text-[var(--st-ink-muted)]">Values of {name}</legend>
                {attribute.values.map((entry, valueIndex) => {
                  const valueName = displayName(entry.value) || `value ${valueIndex + 1}`;
                  return (
                    <div key={valueIndex} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                      <LocalizedPair
                        label="Value"
                        value={entry.value}
                        disabled={disabled}
                        onChange={(next) => setValue(valueIndex, { value: next, key: entry.key === suggestKey(entry.value.en) ? suggestKey(next.en) : entry.key })}
                      />
                      <CustomInput label="Key" className="st-figure" value={entry.key} maxLength={50} disabled={disabled} onChange={(event) => setValue(valueIndex, { ...entry, key: event.target.value })} />
                      <CustomButton type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${valueName} from ${name}`}
                        disabled={disabled || attribute.values.length === 1}
                        onClick={() => update(index, { ...attribute, values: attribute.values.filter((_, i) => i !== valueIndex) })}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </CustomButton>
                    </div>
                  );
                })}
                <div>
                  <CustomButton type="button"
                    variant="ghost"
                    leftIcon={Plus}
                    disabled={disabled}
                    onClick={() => update(index, { ...attribute, values: [...attribute.values, { key: "", value: { ar: "", en: "" } }] })}
                  >
                    Add value
                  </CustomButton>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
      <div>
        <CustomButton type="button" variant="outline" leftIcon={Plus} disabled={disabled} onClick={() => onChange([...value, newAttribute()])}>
          Add attribute
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
