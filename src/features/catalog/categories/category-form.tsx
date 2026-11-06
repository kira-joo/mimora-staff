"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import type { ImageAsset } from "@kira-joo/toolkit-common";
import { useRouter } from "next/navigation";
import { type Category, type CategoryInput, type createCategoryEndpoint, type updateCategoryEndpoint } from "src/api/categories.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { uploadCategoryImageEndpoint } from "src/api/media.endpoints";
import { ImageUploadField } from "src/features/media/image-upload-field";
import { catalogMediaSpec } from "src/server/admin/media/media-targets";
import { displayName } from "../catalog-display";
import { NONE } from "../use-catalog-options";
import { useCategoryOptions } from "./use-category-options";

type CategoryFormValues = Omit<CategoryInput, "parentId"> & { parentId: string };

const EMPTY_TEXT = { ar: "", en: "" };

function sections(parentOptions: { value: string; label: string }[]): FormSection<CategoryFormValues>[] {
  return [
    {
      title: "Identity",
      description: "Shown on the storefront in both languages.",
      columns: 1,
      fields: [
        { type: FieldType.LOCALIZED_INPUT, name: "name", label: "Name" },
        {
          type: FieldType.INPUT,
          name: "slug",
          label: "Slug",
          description: "The category's address on the storefront. Must be unique.",
          rules: { required: true, maxLength: 200 },
        },
        { type: FieldType.SELECT, name: "parentId", label: "Parent category", description: "Nest it under another category, or keep it at the top level.", options: parentOptions },
        { type: FieldType.LOCALIZED_TEXTAREA, name: "description", label: "Description", rows: 4 },
      ],
    },
    {
      title: "Image",
      description: "The category's tile on the storefront home page and its page header.",
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "image",
          render: ({ field, error }) => (
            <>
              <ImageUploadField
                label="Category image"
                value={field.value as ImageAsset | null | undefined}
                onChange={field.onChange}
                uploadEndpoint={uploadCategoryImageEndpoint}
                policy={catalogMediaSpec("category").policy}
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
}

export interface CategoryFormProps {
  endpoint: typeof createCategoryEndpoint | typeof updateCategoryEndpoint;
  oldData?: Category;
}

/** API shape → form values; no category → the create defaults. A missing parent becomes the "top level" option. */
export function mapCategoryToFormValues(oldData?: Category): CategoryFormValues {
  return {
    name: oldData?.name ?? EMPTY_TEXT,
    slug: oldData?.slug ?? "",
    parentId: oldData?.parentId ?? NONE,
    description: oldData?.description ?? EMPTY_TEXT,
    image: oldData?.image ?? null,
    seoTitle: oldData?.seoTitle ?? EMPTY_TEXT,
    seoDescription: oldData?.seoDescription ?? EMPTY_TEXT,
    published: oldData?.published ?? true,
  };
}

/**
 * Earns its place over a bare CustomForm: it loads the parent options and
 * maps "top level" both ways — on an edit it is sent as `null`, which the API
 * reads as "move to the top level"; on a create it is simply omitted.
 */
export function CategoryForm({ endpoint, oldData }: CategoryFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(oldData);
  // Neither itself nor anything beneath it is offered as a parent — the API would refuse the cycle anyway.
  const parents = useCategoryOptions({ excludeSubtreeOf: oldData?._id, none: "None — top level" });

  const toBody = ({ parentId, image, ...rest }: CategoryFormValues): CategoryInput => ({
    ...rest,
    parentId: parentId === NONE ? (isEdit ? null : undefined) : parentId,
    // `null` removes the stored image on an edit; on a create there is nothing to remove, so it is left out.
    image: image ?? (isEdit ? null : undefined),
  });

  return (
    <CustomForm<CategoryFormValues, typeof endpoint>
      mode={isEdit ? "edit" : "create"}
      sections={sections(parents.options)}
      defaultValues={mapCategoryToFormValues(oldData)}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      transformValues={toBody}
      submitButtonText={isEdit ? "Save category" : "Create category"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        toast.success(isEdit ? "Category saved" : `${displayName(saved.name)} created`);
        router.push(AppRoute.CATEGORIES);
      }}
    />
  );
}
