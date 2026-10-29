"use client";

import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import type { LocalizedText } from "src/api/brands.endpoints";

/** An English + Arabic pair for a row editor, Arabic set right-to-left. `label` names the pair for assistive technology. */
export function LocalizedPair({ label, value, onChange, disabled }: { label: string; value: LocalizedText; onChange: (next: LocalizedText) => void; disabled?: boolean }) {
  return (
    <>
      <CustomInput label={`${label} (English)`} dir="auto" value={value.en} disabled={disabled} onChange={(event) => onChange({ ...value, en: event.target.value })} />
      <CustomInput label={`${label} (Arabic)`} dir="rtl" lang="ar" value={value.ar} disabled={disabled} onChange={(event) => onChange({ ...value, ar: event.target.value })} />
    </>
  );
}
