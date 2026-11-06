"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { STOREFRONT_CONTENT_LIMITS, type saveStorefrontContentDraftEndpoint, type StorefrontContentAdminView } from "src/api/storefront-content.endpoints";
import { ReadOnlyNotice } from "src/features/settings/settings-fields";
import { AnnouncementsEditor, NavigationEditor } from "./announcements-and-navigation-editors";
import { HomeSectionsEditor } from "./home-sections-editor";
import { PublishPanel } from "./publish-panel";
import { mapStorefrontContentToFormValues, toSaveBody, type AnnouncementValue, type NavItemValue, type SectionValue, type StorefrontContentFormValues } from "./storefront-content-values";
import { useLinkOptions, type LinkOptions } from "./use-link-options";

type Form = StorefrontContentFormValues;

function buildSections(options: LinkOptions, readOnly: boolean): FormSection<Form>[] {
  const L = STOREFRONT_CONTENT_LIMITS;
  return [
    {
      title: "Announcement bar",
      description: `Up to ${L.announcements}. The storefront shows one at a time: the first enabled announcement whose dates include today.`,
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "announcements",
          render: ({ field, form }) => <AnnouncementsEditor value={(field.value as AnnouncementValue[] | undefined) ?? []} onChange={field.onChange} form={form} links={options.links} disabled={readOnly} />,
        },
      ],
    },
    {
      title: "Header navigation",
      description: `The storefront menu lists your published categories automatically, in their Catalog → Categories order, with sub-categories as dropdowns. Add collections or pages here (up to ${L.headerNavigation}) to show them after the categories; category links here are not repeated in the menu.`,
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "headerNavigation",
          render: ({ field, form }) => <NavigationEditor list="headerNavigation" noun="Header link" value={(field.value as NavItemValue[] | undefined) ?? []} onChange={field.onChange} form={form} links={options.links} disabled={readOnly} />,
        },
      ],
    },
    {
      title: "Footer navigation",
      description: `Up to ${L.footerNavigation} links. Your legal pages are always listed in the footer as well and can't be removed here.`,
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "footerNavigation",
          render: ({ field, form }) => <NavigationEditor list="footerNavigation" noun="Footer link" value={(field.value as NavItemValue[] | undefined) ?? []} onChange={field.onChange} form={form} links={options.links} disabled={readOnly} />,
        },
      ],
    },
    {
      title: "Home page sections",
      description: `Up to ${L.homeSections}, top to bottom. You choose and order them; the storefront decides how each looks.`,
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "homeSections",
          render: ({ field, form }) => <HomeSectionsEditor value={(field.value as SectionValue[] | undefined) ?? []} onChange={field.onChange} form={form} options={options} disabled={readOnly} />,
        },
      ],
    },
  ];
}

export interface StorefrontContentFormProps {
  /** Chosen by the page: the draft save. */
  endpoint: typeof saveStorefrontContentDraftEndpoint;
  /** The saved record the form starts from and the publish panel reports on. */
  oldData: StorefrontContentAdminView;
  canUpdate: boolean;
  canPublish: boolean;
}

/**
 * The one form for the whole draft. Save draft is its submit; Preview and Publish act on the SAVED draft, so the
 * panel above it is told when the form has unsaved edits.
 */
export function StorefrontContentForm({ endpoint, oldData, canUpdate, canPublish }: StorefrontContentFormProps) {
  const queryClient = useQueryClient();
  const options = useLinkOptions();
  const form = useForm<Form>({ defaultValues: mapStorefrontContentToFormValues(oldData) });
  const sections = useMemo(() => buildSections(options, !canUpdate), [options, canUpdate]);

  return (
    <div className="flex flex-col gap-4">
      <PublishPanel content={oldData} dirty={form.formState.isDirty} canPublish={canPublish} />
      {canUpdate ? null : <ReadOnlyNotice />}
      <CustomForm<Form, typeof endpoint>
        form={form}
        mode="edit"
        sections={sections}
        submitEndpoint={endpoint}
        transformValues={toSaveBody}
        submitButtonText="Save draft"
        hideDefaultActions={!canUpdate}
        warnOnUnsavedChanges
        onSuccess={(saved) => {
          form.reset(mapStorefrontContentToFormValues(saved));
          void queryClient.invalidateQueries();
          toast.success("Draft saved. Customers still see what is published.");
        }}
      />
    </div>
  );
}
