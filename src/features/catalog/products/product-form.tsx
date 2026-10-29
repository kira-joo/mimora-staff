"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { listBrandsEndpoint, type LocalizedText } from "src/api/brands.endpoints";
import { listCategoriesEndpoint } from "src/api/categories.endpoints";
import { listCollectionsEndpoint } from "src/api/collections.endpoints";
import type { createProductEndpoint, updateProductEndpoint, OptionAxis, Product, ProductAttribute, ProductInput } from "src/api/products.endpoints";
import { listSizeGuidesEndpoint } from "src/api/size-guides.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "../catalog-display";
import { NONE, useCatalogOptions } from "../use-catalog-options";
import { AttributesEditor } from "./attributes-editor";
import { OptionAxesEditor } from "./option-axes-editor";
import { attributesProblem, axesProblem, cleanAttributes, cleanAxes } from "./product-options";

interface ProductFormValues {
  name: LocalizedText;
  description: LocalizedText;
  slug: string;
  categoryId: string;
  collectionIds: string[];
  brandId: string;
  sizeGuide: string;
  optionAxes: OptionAxis[];
  attributes: ProductAttribute[];
  seoTitle: LocalizedText;
  seoDescription: LocalizedText;
}

type Option = { value: string; label: string };

const EMPTY_TEXT = { ar: "", en: "" };

function sections(lists: { categories: Option[]; brands: Option[]; sizeGuides: Option[] }, variantCount: number): FormSection<ProductFormValues>[] {
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
          description: "The product's address on the storefront. Must be unique.",
          rules: { required: true, maxLength: 200 },
        },
        { type: FieldType.LOCALIZED_TEXTAREA, name: "description", label: "Description", rows: 5 },
      ],
    },
    {
      title: "Placement",
      description: "Where customers find it.",
      columns: 2,
      fields: [
        { type: FieldType.SELECT, name: "categoryId", label: "Category", options: lists.categories, rules: { required: true } },
        { type: FieldType.SELECT, name: "brandId", label: "Brand", options: lists.brands },
        {
          type: FieldType.FEATURE_COMBOBOX,
          name: "collectionIds",
          label: "Collections",
          multiple: true,
          endpoint: listCollectionsEndpoint,
          query: { limit: 100 },
          optionLabel: (item) => displayName(item.name as LocalizedText),
          optionValue: "_id",
          placeholder: "Add to collections",
          colSpan: "full",
        },
        { type: FieldType.SELECT, name: "sizeGuide", label: "Size guide", options: lists.sizeGuides },
      ],
    },
    {
      title: "Options",
      description: "What a customer chooses between — each variant takes one value per option.",
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "optionAxes",
          rules: { validate: (axes) => axesProblem(axes as OptionAxis[]) ?? true },
          render: ({ field, error }) => (
            <OptionAxesEditor value={field.value as OptionAxis[]} onChange={field.onChange} error={error} disabled={field.disabled} variantCount={variantCount} />
          ),
        },
      ],
    },
    {
      title: "Attributes",
      description: "Facts customers filter by — material, fit, care.",
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "attributes",
          rules: { validate: (attributes) => attributesProblem(attributes as ProductAttribute[]) ?? true },
          render: ({ field, error }) => <AttributesEditor value={field.value as ProductAttribute[]} onChange={field.onChange} error={error} disabled={field.disabled} />,
        },
      ],
    },
    {
      title: "Search engines",
      columns: 1,
      fields: [
        { type: FieldType.LOCALIZED_INPUT, name: "seoTitle", label: "SEO title" },
        { type: FieldType.LOCALIZED_TEXTAREA, name: "seoDescription", label: "SEO description", rows: 3 },
      ],
    },
  ];
}

export interface ProductFormProps {
  endpoint: typeof createProductEndpoint | typeof updateProductEndpoint;
  oldData?: Product;
  /** How many variants exist — the options editor warns that changing options doesn't update them. */
  variantCount?: number;
}

/** API shape → form values; no product → the create defaults. Unlinked brand / size guide become the "none" option. */
export function mapProductToFormValues(oldData?: Product): ProductFormValues {
  return {
    name: oldData?.name ?? EMPTY_TEXT,
    description: oldData?.description ?? EMPTY_TEXT,
    slug: oldData?.slug ?? "",
    categoryId: oldData?.categoryId ?? "",
    collectionIds: oldData?.collectionIds ?? [],
    brandId: oldData?.brandId ?? NONE,
    sizeGuide: oldData?.sizeGuide ?? NONE,
    optionAxes: oldData?.optionAxes ?? [],
    attributes: oldData?.attributes ?? [],
    seoTitle: oldData?.seoTitle ?? EMPTY_TEXT,
    seoDescription: oldData?.seoDescription ?? EMPTY_TEXT,
  };
}

/**
 * The product's content and placement. Price and stock are not here — a
 * variant owns both. Owns the reference pickers, the option and attribute
 * editors and their cleaning, and the unlink mapping ("none" is sent as
 * `null` on an edit, omitted on a create). A create opens the new draft's
 * page to add variants; an edit stays and resets to what was saved.
 */
export function ProductForm({ endpoint, oldData, variantCount = 0 }: ProductFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(oldData);
  const categories = useCatalogOptions(listCategoriesEndpoint);
  const brands = useCatalogOptions(listBrandsEndpoint, { none: "No brand" });
  const sizeGuides = useCatalogOptions(listSizeGuidesEndpoint, { none: "No size guide" });
  const form = useForm<ProductFormValues>({ defaultValues: mapProductToFormValues(oldData) });

  const unlink = (value: string) => (value === NONE ? (isEdit ? null : undefined) : value);
  const toBody = (values: ProductFormValues): ProductInput => ({
    ...values,
    brandId: unlink(values.brandId),
    sizeGuide: unlink(values.sizeGuide),
    optionAxes: cleanAxes(values.optionAxes),
    attributes: cleanAttributes(values.attributes),
  });

  return (
    <CustomForm<ProductFormValues, typeof endpoint>
      form={form}
      mode={isEdit ? "edit" : "create"}
      sections={sections({ categories: categories.options, brands: brands.options, sizeGuides: sizeGuides.options }, variantCount)}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      transformValues={toBody}
      submitButtonText={isEdit ? "Save product" : "Create draft"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        // Clean again, so the unsaved-changes guard doesn't fire on what was just saved.
        form.reset(mapProductToFormValues(saved));
        if (isEdit) {
          toast.success("Product saved");
        } else {
          toast.success(`${displayName(saved.name)} created as a draft — add its variants next`);
          router.push(AppRoute.PRODUCT(saved._id));
        }
      }}
    />
  );
}
