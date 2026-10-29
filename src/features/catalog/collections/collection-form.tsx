"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { useRouter } from "next/navigation";
import type { createCollectionEndpoint, updateCollectionEndpoint, Collection, CollectionInput } from "src/api/collections.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { uploadCollectionImageEndpoint } from "src/api/media.endpoints";
import { ImageUploadField } from "src/features/media/image-upload-field";
import { catalogMediaSpec } from "src/server/admin/media/media-targets";
import { displayName } from "../catalog-display";

const SECTIONS: FormSection<CollectionInput>[] = [
  {
    title: "Identity",
    description: "Shown on the storefront in both languages. Products join a collection from their own page.",
    columns: 1,
    fields: [
      { type: FieldType.LOCALIZED_INPUT, name: "name", label: "Name" },
      {
        type: FieldType.INPUT,
        name: "slug",
        label: "Slug",
        description: "The collection's address on the storefront. Must be unique.",
        rules: { required: true, maxLength: 200 },
      },
      { type: FieldType.LOCALIZED_TEXTAREA, name: "description", label: "Description", rows: 4 },
    ],
  },
  {
    title: "Image",
    description: "Shown with the collection on the storefront — a campaign banner or the collection story on the home page.",
    columns: 1,
    fields: [
      {
        type: FieldType.CUSTOM,
        name: "image",
        render: ({ field, error }) => (
          <>
            <ImageUploadField
              label="Collection image"
              value={field.value as ImageAsset | null | undefined}
              onChange={field.onChange}
              uploadEndpoint={uploadCollectionImageEndpoint}
              policy={catalogMediaSpec("collection").policy}
              disabled={field.disabled}
              previewClassName="h-28 w-36"
            />
            {error ? <p role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)]">{error}</p> : null}
          </>
        ),
      },
    ],
  },
  {
    title: "Search engines",
    description: "The title and summary search results show.",
    columns: 1,
    fields: [
      { type: FieldType.LOCALIZED_INPUT, name: "seoTitle", label: "SEO title" },
      { type: FieldType.LOCALIZED_TEXTAREA, name: "seoDescription", label: "SEO description", rows: 3 },
    ],
  },
  {
    title: "Visibility",
    columns: 1,
    fields: [{ type: FieldType.SWITCH, name: "published", label: "Published on the storefront" }],
  },
];

const EMPTY_TEXT = { ar: "", en: "" };

export interface CollectionFormProps {
  endpoint: typeof createCollectionEndpoint | typeof updateCollectionEndpoint;
  oldData?: Collection;
}

/** API shape → form values; no collection → the create defaults. SEO text may be missing on older records. */
export function mapCollectionToFormValues(oldData?: Collection): CollectionInput {
  return {
    name: oldData?.name ?? EMPTY_TEXT,
    slug: oldData?.slug ?? "",
    description: oldData?.description ?? EMPTY_TEXT,
    image: oldData?.image ?? null,
    seoTitle: oldData?.seoTitle ?? EMPTY_TEXT,
    seoDescription: oldData?.seoDescription ?? EMPTY_TEXT,
    published: oldData?.published ?? true,
  };
}

/** The brand form's pattern; the one client boundary the create and edit pages share. */
export function CollectionForm({ endpoint, oldData }: CollectionFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(oldData);

  return (
    <CustomForm<CollectionInput, typeof endpoint>
      mode={isEdit ? "edit" : "create"}
      sections={SECTIONS}
      defaultValues={mapCollectionToFormValues(oldData)}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      // `null` removes the stored image on an edit; on a create there is nothing to remove, so it is left out.
      transformValues={({ image, ...rest }) => ({ ...rest, image: image ?? (isEdit ? null : undefined) })}
      submitButtonText={isEdit ? "Save collection" : "Create collection"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        toast.success(isEdit ? "Collection saved" : `${displayName(saved.name)} created`);
        router.push(AppRoute.COLLECTIONS);
      }}
    />
  );
}
