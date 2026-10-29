"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { useRouter } from "next/navigation";
import type { createBrandEndpoint, updateBrandEndpoint, Brand, BrandInput } from "src/api/brands.endpoints";
import { AppRoute } from "src/common/routes/app-route";

const SECTIONS: FormSection<BrandInput>[] = [
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
        description: "The brand's address on the storefront. Must be unique.",
        rules: { required: true, maxLength: 200 },
      },
      { type: FieldType.LOCALIZED_TEXTAREA, name: "description", label: "Description", rows: 4 },
    ],
  },
  {
    title: "Visibility",
    columns: 1,
    fields: [{ type: FieldType.SWITCH, name: "published", label: "Published on the storefront" }],
  },
];

export interface BrandFormProps {
  endpoint: typeof createBrandEndpoint | typeof updateBrandEndpoint;
  /** The brand being edited; absent on the create page. */
  oldData?: Brand;
}

/** API shape → form values; no brand → the create defaults. */
export function mapBrandToFormValues(oldData?: Brand): BrandInput {
  return {
    name: oldData?.name ?? { ar: "", en: "" },
    slug: oldData?.slug ?? "",
    description: oldData?.description ?? { ar: "", en: "" },
    published: oldData?.published ?? true,
  };
}

/**
 * The form pattern: the page picks the endpoint, `oldData` marks an edit, and
 * the mapper owns defaults. The toolkit's CustomForm owns submission, the busy
 * state, the unsaved-changes guard, and server validation errors (each lands
 * on its own field, `name.ar` on the Arabic input). Kept as a component
 * because it is the one client boundary both server pages share.
 */
export function BrandForm({ endpoint, oldData }: BrandFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(oldData);

  return (
    <CustomForm<BrandInput, typeof endpoint>
      mode={isEdit ? "edit" : "create"}
      sections={SECTIONS}
      defaultValues={mapBrandToFormValues(oldData)}
      submitEndpoint={endpoint}
      // Required by the types, not the runtime: the union's params are { id: string }, and a create has no id.
      submitParams={oldData ? { id: oldData._id } : undefined}
      submitButtonText={isEdit ? "Save brand" : "Create brand"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        toast.success(isEdit ? "Brand saved" : `${saved.name.en || saved.name.ar} created`);
        router.push(AppRoute.BRANDS);
      }}
    />
  );
}
