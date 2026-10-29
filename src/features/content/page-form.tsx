"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { useRouter } from "next/navigation";
import type { createPageEndpoint, updatePageEndpoint, ContentPage, ContentPageInput } from "src/api/pages.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "src/features/catalog/catalog-display";
import { mapPageToFormValues, pageToBody } from "./page-values";

const SECTIONS: FormSection<ContentPageInput>[] = [
  {
    title: "Page",
    description: "Shown in both languages.",
    columns: 1,
    fields: [
      { type: FieldType.LOCALIZED_INPUT, name: "title", label: "Title" },
      {
        type: FieldType.INPUT,
        name: "slug",
        label: "Slug",
        description: "The page's address on the storefront. Must be unique.",
        rules: { required: true, maxLength: 200 },
      },
      { type: FieldType.LOCALIZED_TEXTAREA, name: "content", label: "Content", rows: 14 },
    ],
  },
  {
    title: "Search engines",
    description: "Optional. The social-share image is not editable here yet.",
    columns: 1,
    fields: [
      { type: FieldType.LOCALIZED_INPUT, name: "seo.title", label: "SEO title" },
      { type: FieldType.LOCALIZED_TEXTAREA, name: "seo.description", label: "SEO description", rows: 3 },
    ],
  },
  {
    title: "Visibility",
    columns: 1,
    fields: [{ type: FieldType.SWITCH, name: "published", label: "Published on the storefront" }],
  },
];

export interface PageFormProps {
  endpoint: typeof createPageEndpoint | typeof updatePageEndpoint;
  /** The page being edited; absent on the create page. */
  oldData?: ContentPage;
}

export function PageForm({ endpoint, oldData }: PageFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(oldData);

  return (
    <CustomForm<ContentPageInput, typeof endpoint>
      mode={isEdit ? "edit" : "create"}
      sections={SECTIONS}
      defaultValues={mapPageToFormValues(oldData)}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      transformValues={pageToBody}
      submitButtonText={isEdit ? "Save page" : "Create page"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        toast.success(isEdit ? "Page saved" : `${displayName(saved.title) || saved.slug} created`);
        router.push(AppRoute.PAGES);
      }}
    />
  );
}
