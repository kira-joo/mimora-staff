"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomForm, FieldType, FormInput, type FormFieldConfig, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { CustomCheckbox } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { PageShell, QueryState, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { uploadStoreProfileImageEndpoint } from "src/api/media.endpoints";
import { getStoreProfileEndpoint, updateStoreProfileEndpoint, type StoredImage, type StoreProfile } from "src/api/settings.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { usePermission } from "src/features/auth/use-permission";
import { ImageUploadField } from "src/features/media/image-upload-field";
import { storeProfileMediaSpec, type StoreProfileSlot } from "src/server/admin/media/media-targets";
import { CURRENCY_CODE, disableFields } from "./settings-helpers";
import { storeProfileToForm, toStoreProfileBody, type StoreProfileFormValues } from "./settings-bodies";
import { AddRowButton, ReadOnlyNotice, RowFrame, SettingsNote, textField } from "./settings-fields";

type Form = StoreProfileFormValues;

const MAX_SOCIAL_LINKS = 20;

const LOCALES = [
  { value: "ar", label: "Arabic" },
  { value: "en", label: "English" },
];

function buildSections(readOnly: boolean): FormSection<Form>[] {
  return disableFields<Form>(
    [
      {
        title: "Identity",
        description: "How the store introduces itself, in both languages. Shown on the storefront.",
        columns: 1,
        fields: [
          { type: FieldType.LOCALIZED_INPUT, name: "name", label: "Store name" },
          { type: FieldType.LOCALIZED_INPUT, name: "tagline", label: "Tagline" },
          { type: FieldType.LOCALIZED_TEXTAREA, name: "description", label: "Description", rows: 3 },
        ],
      },
      {
        title: "Contact",
        description: "Where customers reach the store. Phone and email are required once any contact is saved.",
        layout: "grid",
        columns: 2,
        fields: [
          textField<Form>({
            name: "contact.phone",
            label: "Phone",
            dir: "ltr",
            type: "tel",
            autoComplete: "tel",
            rules: { required: "Enter a phone number" },
            disabled: readOnly,
          }),
          textField<Form>({
            name: "contact.email",
            label: "Email",
            dir: "ltr",
            type: "email",
            autoComplete: "email",
            rules: { required: "Enter an email address" },
            disabled: readOnly,
          }),
          textField<Form>({ name: "contact.whatsApp", label: "WhatsApp", description: "Optional.", dir: "ltr", type: "tel", disabled: readOnly }),
        ],
      },
      {
        title: "Currency and languages",
        description: "The currency every price and total in this console and the storefront is shown in, and the languages the storefront offers.",
        layout: "grid",
        columns: 2,
        fields: [
          textField<Form>({
            name: "currency",
            label: "Currency code",
            description: "Three-letter ISO code, e.g. EGP.",
            dir: "ltr",
            figure: true,
            maxLength: 3,
            rules: { required: "Enter a currency code", pattern: { value: CURRENCY_CODE, message: "Use a three-letter currency code, e.g. EGP." } },
            disabled: readOnly,
          }),
          {
            type: FieldType.SELECT,
            name: "defaultLocale",
            label: "Default language",
            options: LOCALES,
            rules: { required: true },
          },
          {
            type: FieldType.CUSTOM,
            name: "supportedLocales",
            colSpan: "full",
            rules: {
              validate: (value: unknown, values: Form | Record<string, unknown>) => {
                const chosen = (value as string[] | undefined) ?? [];
                if (chosen.length === 0) return "Choose at least one language";
                return chosen.includes((values as Form).defaultLocale) || "Include the default language";
              },
              deps: ["defaultLocale"],
            },
            render: ({ field, error }) => (
              <SupportedLocales value={(field.value as string[] | undefined) ?? []} onChange={field.onChange} error={error} disabled={readOnly} />
            ),
          },
        ],
      },
      {
        title: "Logo and imagery",
        description: "Your logo, the icon browsers show on a tab, the picture a shared link previews with, and the picture behind the home page's opening banner.",
        columns: 1,
        fields: [
          imageField("logo", "Logo", "Shown in the storefront header and emails.", readOnly),
          imageField("favicon", "Favicon", "The small icon on the browser tab. Square works best.", readOnly),
          imageField("ogImage", "Link preview image", "Shown when a page is shared on social media or messaging apps. Around 1200 × 630 px works best.", readOnly),
          imageField("heroMedia", "Home page hero image", "Behind the opening banner on the home page. Wide and bright works best.", readOnly),
        ],
      },
      {
        title: "Social links",
        description: `Shown in the storefront footer. Up to ${MAX_SOCIAL_LINKS}.`,
        columns: 1,
        fields: [{ type: FieldType.CUSTOM, name: "socialLinks", render: ({ field, form }) => (
              <SocialLinks value={(field.value as Form["socialLinks"] | undefined) ?? []} onChange={field.onChange} form={form} disabled={readOnly} />
            ) }],
      },
      {
        title: "Search appearance",
        description: "The default title and description search engines and link previews use when a page has none of its own.",
        columns: 1,
        fields: [
          { type: FieldType.LOCALIZED_INPUT, name: "seoTitle", label: "Default title" },
          { type: FieldType.LOCALIZED_TEXTAREA, name: "seoDescription", label: "Default description", rows: 3 },
        ],
      },
    ],
    readOnly,
  );
}

/** One image slot as a form field: uploads straight to its slot's policy, holds the stored asset in the form until Save. */
function imageField(slot: StoreProfileSlot, label: string, description: string, disabled: boolean): FormFieldConfig<Form> {
  return {
    type: FieldType.CUSTOM,
    name: slot,
    render: ({ field, error }) => (
      <>
        <ImageUploadField
          label={label}
          description={description}
          value={field.value as StoredImage | null | undefined}
          onChange={field.onChange}
          uploadEndpoint={uploadStoreProfileImageEndpoint}
          uploadBody={{ slot }}
          policy={storeProfileMediaSpec(slot).policy}
          disabled={disabled}
          previewClassName={slot === "favicon" ? "size-16" : "h-24 w-40"}
        />
        {error ? (
          <p role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)]">
            {error}
          </p>
        ) : null}
      </>
    ),
  };
}

function SupportedLocales({ value: selected, onChange, error, disabled }: { value: string[]; onChange: (value: string[]) => void; error?: string; disabled: boolean }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-medium text-[var(--st-ink)]">Supported languages</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {LOCALES.map((locale) => (
          <CustomCheckbox
            key={locale.value}
            label={locale.label}
            checked={selected.includes(locale.value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked ? [...selected, locale.value] : selected.filter((v) => v !== locale.value))}
          />
        ))}
      </div>
      <SettingsNote>Include the default language. The storefront offers only the languages ticked here.</SettingsNote>
      {error ? (
        <p role="alert" className="text-[var(--st-status-danger)]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function SocialLinks({ value: links, onChange, form, disabled }: { value: Form["socialLinks"]; onChange: (value: Form["socialLinks"]) => void; form: UseFormReturn<Form>; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {links.length === 0 ? <SettingsNote>No social links yet.</SettingsNote> : null}
      {links.map((link, index) => (
        <RowFrame
          key={index}
          title={link.platform || `Link ${index + 1}`}
          disabled={disabled}
          onRemove={() => onChange(form.getValues("socialLinks").filter((_, i) => i !== index))}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <FormInput control={form.control} name={`socialLinks.${index}.platform`} label="Platform" dir="auto" disabled={disabled} rules={{ required: true, maxLength: 100 }} />
            <FormInput control={form.control} name={`socialLinks.${index}.url`} label="Address" type="url" dir="ltr" disabled={disabled} rules={{ required: true }} />
          </div>
        </RowFrame>
      ))}
      {disabled ? null : (
        <AddRowButton disabled={links.length >= MAX_SOCIAL_LINKS} onClick={() => onChange([...form.getValues("socialLinks"), { platform: "", url: "" }])}>
          Add a link
        </AddRowButton>
      )}
    </div>
  );
}

function StoreProfileForm({ profile, canUpdate }: { profile: StoreProfile; canUpdate: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<Form>({ defaultValues: storeProfileToForm(profile) });
  const sections = useMemo(() => buildSections(!canUpdate), [canUpdate]);

  return (
    <CustomForm<Form, typeof updateStoreProfileEndpoint>
      form={form}
      mode="edit"
      sections={sections}
      submitEndpoint={updateStoreProfileEndpoint}
      transformValues={toStoreProfileBody}
      submitButtonText="Save store profile"
      hideDefaultActions={!canUpdate}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        form.reset(storeProfileToForm(saved));
        void queryClient.invalidateQueries();
        toast.success("Store profile saved");
        // The console layout reads the currency on the server for every price it shows; re-render it so a change applies now.
        router.refresh();
      }}
    />
  );
}

/** The store profile screen: identity, logo and imagery, contact, currency and languages, social links, default SEO. */
export function StoreProfileView() {
  const can = usePermission();
  const canUpdate = can(AppPermission.STORE_PROFILE.UPDATE);
  const query = useRequesterQuery({ endpoint: getStoreProfileEndpoint });
  return (
    <QueryState query={query} entityName="store profile">
      {(profile) => (
        <PageShell title="Store profile" description="Who the store is and how customers reach it.">
          {canUpdate ? null : <ReadOnlyNotice />}
          <StoreProfileForm key={profile.updatedAt} profile={profile} canUpdate={canUpdate} />
        </PageShell>
      )}
    </QueryState>
  );
}
