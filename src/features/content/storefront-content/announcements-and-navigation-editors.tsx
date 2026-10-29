"use client";

import { FormDatePicker, FormLocalizedInput, FormSelect, FormSwitch } from "@kira-joo/frontend-toolkit-tailwind/forms";
import type { UseFormReturn } from "react-hook-form";
import { STOREFRONT_CONTENT_LIMITS } from "src/api/storefront-content.endpoints";
import { AddRowButton, SettingsNote } from "src/features/settings/settings-fields";
import { moveItem } from "src/components/reorder-dialog";
import { NONE } from "src/features/catalog/use-catalog-options";
import { ListRow } from "./list-row";
import { newAnnouncement, newNavItem, type AnnouncementValue, type NavItemValue, type StorefrontContentFormValues } from "./storefront-content-values";
import type { PickerOption } from "./use-link-options";

type Form = UseFormReturn<StorefrontContentFormValues>;

const withNone = (options: PickerOption[], label: string): PickerOption[] => [{ value: NONE, label }, ...options];

const preview = (value: { ar: string; en: string }) => value.en.trim() || value.ar.trim();

interface EditorProps<T> {
  value: T[];
  onChange: (value: T[]) => void;
  form: Form;
  links: PickerOption[];
  disabled: boolean;
}

export function AnnouncementsEditor({ value: items, onChange, form, links, disabled }: EditorProps<AnnouncementValue>) {
  const limit = STOREFRONT_CONTENT_LIMITS.announcements;
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? <SettingsNote>No announcements. The storefront shows no bar.</SettingsNote> : null}
      <ol className="flex flex-col gap-3">
        {items.map((item, index) => (
          <ListRow
            key={index}
            name={`announcement ${index + 1}`}
            title={preview(item.message) || `Announcement ${index + 1}`}
            disabled={disabled}
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
            onMoveUp={() => onChange(moveItem(form.getValues("announcements"), index, -1))}
            onMoveDown={() => onChange(moveItem(form.getValues("announcements"), index, 1))}
            onRemove={() => onChange(form.getValues("announcements").filter((_, i) => i !== index))}
          >
            <FormLocalizedInput control={form.control} name={`announcements.${index}.message`} label="Message" disabled={disabled} />
            <FormSelect control={form.control} name={`announcements.${index}.target`} label="Link (optional)" options={withNone(links, "No link")} placeholder="No link" disabled={disabled} />
            <div className="grid gap-4 md:grid-cols-2">
              <FormDatePicker control={form.control} name={`announcements.${index}.startsAt`} label="Shows from (optional)" includeTime disabled={disabled} />
              <FormDatePicker
                control={form.control}
                name={`announcements.${index}.endsAt`}
                label="Shows until (optional)"
                includeTime
                disabled={disabled}
                rules={{
                  validate: (end: unknown) => {
                    const start = form.getValues(`announcements.${index}.startsAt`);
                    return !end || !start || new Date(String(end)) > new Date(start) ? true : "The end must be after the start.";
                  },
                }}
              />
            </div>
            <FormSwitch control={form.control} name={`announcements.${index}.enabled`} label="Enabled" description="The storefront shows the first enabled announcement whose dates include today." disabled={disabled} />
          </ListRow>
        ))}
      </ol>
      {disabled ? null : (
        <AddRowButton disabled={items.length >= limit} onClick={() => onChange([...form.getValues("announcements"), newAnnouncement()])}>
          {items.length >= limit ? `Limit of ${limit} reached` : "Add announcement"}
        </AddRowButton>
      )}
    </div>
  );
}

interface NavigationEditorProps extends EditorProps<NavItemValue> {
  list: "headerNavigation" | "footerNavigation";
  noun: string;
}

export function NavigationEditor({ list, noun, value: items, onChange, form, links, disabled }: NavigationEditorProps) {
  const limit = STOREFRONT_CONTENT_LIMITS[list];
  const labelOf = (item: NavItemValue) => preview(item.label) || links.find((option) => option.value === item.target)?.label || `${noun} ${items.indexOf(item) + 1}`;
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? <SettingsNote>No {noun.toLowerCase()}s yet.</SettingsNote> : null}
      <ol className="flex flex-col gap-3">
        {items.map((item, index) => (
          <ListRow
            key={index}
            name={`${noun.toLowerCase()} ${index + 1}`}
            title={labelOf(item)}
            disabled={disabled}
            canMoveUp={index > 0}
            canMoveDown={index < items.length - 1}
            onMoveUp={() => onChange(moveItem(form.getValues(list), index, -1))}
            onMoveDown={() => onChange(moveItem(form.getValues(list), index, 1))}
            onRemove={() => onChange(form.getValues(list).filter((_, i) => i !== index))}
          >
            <FormSelect control={form.control} name={`${list}.${index}.target`} label="Links to" options={links} placeholder="Choose a category, collection or page" disabled={disabled} rules={{ required: "Choose where this link goes." }} />
            <FormLocalizedInput control={form.control} name={`${list}.${index}.label`} label="Link text (optional)" description="Leave both empty to use the name of what it links to." disabled={disabled} />
          </ListRow>
        ))}
      </ol>
      {disabled ? null : (
        <AddRowButton disabled={items.length >= limit} onClick={() => onChange([...form.getValues(list), newNavItem()])}>
          {items.length >= limit ? `Limit of ${limit} reached` : `Add ${noun.toLowerCase()}`}
        </AddRowButton>
      )}
    </div>
  );
}
