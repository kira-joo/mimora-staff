"use client";

import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { FormLocalizedInput, FormLocalizedTextarea, FormRadioGroup, FormSelect } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { Plus } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import { STOREFRONT_CONTENT_LIMITS, type HomeSectionType } from "src/api/storefront-content.endpoints";
import { moveItem } from "src/components/reorder-dialog";
import { NONE } from "src/features/catalog/use-catalog-options";
import { SettingsNote } from "src/features/settings/settings-fields";
import { ListRow, RowError } from "./list-row";
import { newSection, SECTION_LABELS, type SectionValue, type StorefrontContentFormValues } from "./storefront-content-values";
import type { LinkOptions } from "./use-link-options";

type Form = UseFormReturn<StorefrontContentFormValues>;

/** The fixed library, in the order they are offered. */
const LIBRARY: Array<{ type: HomeSectionType; description: string }> = [
  { type: "campaignHero", description: "The big opening banner: headline, subline and one button. Must be first, once." },
  { type: "collectionStory", description: "A collection's image beside a short story about it." },
  { type: "productRail", description: "A row of products, from a collection or the newest arrivals." },
  { type: "categoryTiles", description: "Tiles that open up to 8 chosen categories." },
  { type: "editorialBand", description: "A full-width band with a headline, linking to a collection." },
  { type: "assuranceStrip", description: "Delivery, returns and payment reassurance. Once only." },
];

const sourceOf = (form: Form, index: number) => {
  const section = form.getValues("homeSections")[index];
  return section?.type === "productRail" ? section.source : undefined;
};

const preview = (value: { ar: string; en: string } | undefined) => value?.en.trim() || value?.ar.trim() || "";

function sectionTitle(section: SectionValue, index: number): string {
  const text = "headline" in section ? preview(section.headline) : "heading" in section ? preview(section.heading) : "";
  return `${index + 1}. ${SECTION_LABELS[section.type]}${text ? ` · ${text}` : ""}`;
}

function SectionFields({ section, index, form, options, disabled }: { section: SectionValue; index: number; form: Form; options: LinkOptions; disabled: boolean }) {
  const path = (key: string) => `homeSections.${index}.${key}` as never;
  switch (section.type) {
    case "campaignHero":
      return (
        <>
          <FormLocalizedInput control={form.control} name={path("headline")} label="Headline" disabled={disabled} />
          <FormLocalizedInput control={form.control} name={path("subline")} label="Subline (optional)" disabled={disabled} />
          <div className="grid gap-4 md:grid-cols-2">
            <FormLocalizedInput control={form.control} name={path("actionLabel")} label="Button text (optional)" disabled={disabled} />
            <FormSelect control={form.control} name={path("target")} label="Button links to (optional)" options={[{ value: NONE, label: "No button" }, ...options.links]} placeholder="No button" description="The button needs both its text and where it goes." disabled={disabled} />
          </div>
          <SettingsNote>The hero image comes from the store profile's hero media (Settings, Store), not from this section.</SettingsNote>
        </>
      );
    case "collectionStory":
      return (
        <>
          <FormSelect control={form.control} name={path("collectionId")} label="Collection" options={options.collections} placeholder="Choose a collection" disabled={disabled} rules={{ required: "Choose a collection." }} />
          <FormLocalizedInput control={form.control} name={path("heading")} label="Heading (optional)" description="Leave empty to use the collection's name." disabled={disabled} />
          <FormLocalizedTextarea control={form.control} name={path("body")} label="Story (optional)" description="Leave empty to use the collection's description." rows={3} disabled={disabled} />
        </>
      );
    case "productRail":
      return (
        <>
          <FormRadioGroup
            control={form.control}
            name={path("source")}
            label="Products shown"
            orientation="horizontal"
            disabled={disabled}
            options={[
              { value: "newest", label: "Newest arrivals" },
              { value: "collection", label: "From a collection" },
            ]}
          />
          {section.source === "collection" ? (
            <FormSelect
              control={form.control}
              name={path("collectionId")}
              label="Collection"
              options={options.collections}
              placeholder="Choose a collection"
              disabled={disabled}
              rules={{ validate: (value: unknown) => (sourceOf(form, index) !== "collection" || value ? true : "Choose the collection this rail shows.") }}
            />
          ) : null}
          <FormLocalizedInput control={form.control} name={path("heading")} label="Heading (optional)" disabled={disabled} />
        </>
      );
    case "categoryTiles":
      return (
        <>
          <FormSelect
            control={form.control}
            name={path("categoryIds")}
            label="Categories"
            multiple
            options={options.categories}
            placeholder="Choose 1 to 8 categories"
            description="Shown in the order you choose them."
            disabled={disabled}
            rules={{ validate: (value: unknown) => (Array.isArray(value) && value.length >= 1 && value.length <= STOREFRONT_CONTENT_LIMITS.categoryTiles ? true : "Choose between 1 and 8 categories.") }}
          />
          <FormLocalizedInput control={form.control} name={path("heading")} label="Heading (optional)" disabled={disabled} />
        </>
      );
    case "editorialBand":
      return (
        <>
          <FormLocalizedInput control={form.control} name={path("headline")} label="Headline" disabled={disabled} />
          <FormSelect control={form.control} name={path("collectionId")} label="Collection" options={options.collections} placeholder="Choose a collection" description="Its image and link are used." disabled={disabled} rules={{ required: "Choose a collection." }} />
        </>
      );
    case "assuranceStrip":
      return <SettingsNote>No fields. The strip is built from your delivery, returns and payment settings, so it always matches what you actually offer.</SettingsNote>;
  }
}

interface HomeSectionsEditorProps {
  value: SectionValue[];
  onChange: (value: SectionValue[]) => void;
  form: Form;
  options: LinkOptions;
  disabled: boolean;
}

export function HomeSectionsEditor({ value: sections, onChange, form, options, disabled }: HomeSectionsEditorProps) {
  const limit = STOREFRONT_CONTENT_LIMITS.homeSections;
  const hasHero = sections.some((s) => s.type === "campaignHero");
  const hasStrip = sections.some((s) => s.type === "assuranceStrip");
  const full = sections.length >= limit;

  function add(type: HomeSectionType) {
    const current = form.getValues("homeSections");
    // The hero can only be first, so it goes there; everything else goes last.
    onChange(type === "campaignHero" ? [newSection(type), ...current] : [...current, newSection(type)]);
  }

  const blocked = (type: HomeSectionType): string | undefined => {
    if (full) return `Limit of ${limit} sections reached`;
    if (type === "campaignHero" && hasHero) return "Already added";
    if (type === "assuranceStrip" && hasStrip) return "Already added";
    return undefined;
  };

  return (
    <div className="flex flex-col gap-4">
      {sections.length === 0 ? <SettingsNote>No sections. The storefront home page shows only its header and footer.</SettingsNote> : null}
      <ol className="flex flex-col gap-3">
        {sections.map((section, index) => (
          <ListRow
            key={index}
            name={`section ${index + 1}`}
            title={sectionTitle(section, index)}
            disabled={disabled}
            // The hero stays first; nothing may be moved above it.
            canMoveUp={index > 0 && section.type !== "campaignHero" && sections[index - 1]?.type !== "campaignHero"}
            canMoveDown={index < sections.length - 1 && section.type !== "campaignHero"}
            onMoveUp={() => onChange(moveItem(form.getValues("homeSections"), index, -1))}
            onMoveDown={() => onChange(moveItem(form.getValues("homeSections"), index, 1))}
            onRemove={() => onChange(form.getValues("homeSections").filter((_, i) => i !== index))}
          >
            <RowError control={form.control} name={`homeSections.${index}.type` as never} />
            <SectionFields section={section} index={index} form={form} options={options} disabled={disabled} />
          </ListRow>
        ))}
      </ol>
      {disabled ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-[var(--st-ink)]">Add a section</h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {LIBRARY.map(({ type, description }) => {
              const reason = blocked(type);
              return (
                <li key={type}>
                  <CustomButton type="button" variant="outline" className="h-auto min-h-11 w-full items-start justify-start gap-3 py-3 text-start" disabled={Boolean(reason)} onClick={() => add(type)}>
                    <Plus aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal">
                      <span className="font-medium">{SECTION_LABELS[type]}</span>
                      <span className="text-[13px] font-normal text-[var(--st-ink-muted)]">{reason ?? description}</span>
                    </span>
                  </CustomButton>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
