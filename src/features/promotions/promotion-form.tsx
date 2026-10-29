"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CustomButton, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { LocalizedText } from "src/api/brands.endpoints";
import { listCategoriesEndpoint } from "src/api/categories.endpoints";
import { listCollectionsEndpoint } from "src/api/collections.endpoints";
import { listProductsEndpoint } from "src/api/products.endpoints";
import type { createPromotionEndpoint, updatePromotionEndpoint, Promotion } from "src/api/promotions.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { displayName } from "src/features/catalog/catalog-display";
import { StoreDateTimeInput } from "./store-datetime-input";
import {
  codeProblem,
  dateWindowProblem,
  discountValueProblem,
  limitProblem,
  mapPromotionToFormValues,
  minSubtotalProblem,
  promotionToBody,
  type PromotionFormValues,
} from "./promotion-values";

const TYPE_OPTIONS = [
  { value: "PERCENT", label: "Percentage off" },
  { value: "FIXED", label: "Fixed amount off" },
  { value: "FREE_SHIPPING", label: "Free shipping" },
];

function VariantScopeNote({ value, onChange, disabled }: { value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  if (value.length === 0) return <p className="text-[var(--st-ink-muted)]">No specific variants. Variant scoping is not editable here.</p>;
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-[var(--st-line)] bg-[var(--st-canvas)] px-3 py-2">
      <p>
        Limited to {value.length} specific {value.length === 1 ? "variant" : "variants"}. They stay as they are when you save; they cannot be edited here.
      </p>
      <CustomButton type="button" variant="outline" disabled={disabled} onClick={() => onChange([])}>
        Remove the variant restriction
      </CustomButton>
    </div>
  );
}

function sections(type: PromotionFormValues["type"], oldData: Promotion | undefined, getValues: () => PromotionFormValues): FormSection<PromotionFormValues>[] {
  return [
    {
      title: "Promotion",
      description: "Customers see the name and description in both languages.",
      columns: 1,
      fields: [
        { type: FieldType.LOCALIZED_INPUT, name: "name", label: "Name" },
        { type: FieldType.LOCALIZED_TEXTAREA, name: "description", label: "Description", rows: 3 },
        {
          type: FieldType.INPUT,
          name: "code",
          label: "Code",
          description: "What customers enter. Saved in capitals and must be unique. Leave empty for an automatic promotion.",
          rules: { validate: (code) => codeProblem(code) ?? true },
        },
      ],
    },
    {
      title: "Discount",
      description: "Only one promotion applies to an order: the one worth most to the customer.",
      columns: 2,
      fields: [
        { type: FieldType.SELECT, name: "type", label: "Type", options: TYPE_OPTIONS, rules: { required: true } },
        ...(type === "FREE_SHIPPING"
          ? []
          : [
              {
                type: FieldType.INPUT as const,
                name: "value" as const,
                label: type === "PERCENT" ? "Percentage" : "Amount off",
                description: type === "PERCENT" ? "0 to 100." : "In the store's currency.",
                rules: { validate: (value: unknown) => discountValueProblem(getValues().type, value) ?? true },
              },
            ]),
      ],
    },
    {
      title: "Who and what qualifies",
      description: "Leave a scope empty and it applies to everything. A cart item qualifies if it matches any category, collection or product chosen.",
      columns: 1,
      fields: [
        {
          type: FieldType.INPUT,
          name: "minSubtotal",
          label: "Minimum order subtotal",
          description: "Optional. Checked against the whole order, in the store's currency.",
          rules: { validate: (value) => minSubtotalProblem(value) ?? true },
        },
        { type: FieldType.SWITCH, name: "firstOrderOnly", label: "First order only" },
        {
          type: FieldType.FEATURE_COMBOBOX,
          name: "categories",
          label: "Categories",
          multiple: true,
          endpoint: listCategoriesEndpoint,
          query: { limit: 100 },
          optionLabel: (item) => displayName(item.name as LocalizedText),
          optionValue: "_id",
          placeholder: "Any category",
        },
        {
          type: FieldType.FEATURE_COMBOBOX,
          name: "collections",
          label: "Collections",
          multiple: true,
          endpoint: listCollectionsEndpoint,
          query: { limit: 100 },
          optionLabel: (item) => displayName(item.name as LocalizedText),
          optionValue: "_id",
          placeholder: "Any collection",
        },
        {
          type: FieldType.FEATURE_COMBOBOX,
          name: "products",
          label: "Products",
          multiple: true,
          endpoint: listProductsEndpoint,
          query: { limit: 100 },
          optionLabel: (item) => displayName(item.name as LocalizedText),
          optionValue: "_id",
          placeholder: "Any product",
        },
        {
          type: FieldType.CUSTOM,
          name: "variants",
          label: "Variants",
          render: ({ field }) => <VariantScopeNote value={field.value as string[]} onChange={field.onChange} disabled={field.disabled} />,
        },
      ],
    },
    {
      title: "Schedule",
      description: "Optional. Read on the store's clock.",
      columns: 2,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "startsAt",
          render: ({ field, error }) => <StoreDateTimeInput label="Starts" value={field.value as string} onChange={field.onChange} error={error} disabled={field.disabled} />,
        },
        {
          type: FieldType.CUSTOM,
          name: "endsAt",
          rules: { validate: (endsAt) => dateWindowProblem(getValues().startsAt, endsAt as string) ?? true },
          render: ({ field, error }) => <StoreDateTimeInput label="Ends" value={field.value as string} onChange={field.onChange} error={error} disabled={field.disabled} />,
        },
      ],
    },
    {
      title: "Limits",
      description: "Optional. Empty means unlimited.",
      columns: 2,
      fields: [
        {
          type: FieldType.INPUT,
          name: "totalUses",
          label: "Total uses",
          inputType: "number",
          description: oldData ? `Used ${oldData.usageCount} so far.` : undefined,
          rules: { validate: (value) => limitProblem(value) ?? true },
        },
        {
          type: FieldType.INPUT,
          name: "perCustomerUses",
          label: "Uses per customer",
          inputType: "number",
          rules: { validate: (value) => limitProblem(value) ?? true },
        },
      ],
    },
    {
      title: "Availability",
      columns: 1,
      fields: [{ type: FieldType.SWITCH, name: "active", label: "Active (customers can use it, within its schedule and limits)" }],
    },
  ];
}

export interface PromotionFormProps {
  endpoint: typeof createPromotionEndpoint | typeof updatePromotionEndpoint;
  /** The promotion being edited; absent on the create page. */
  oldData?: Promotion;
}

/**
 * The page picks the endpoint, `oldData` marks an edit, the mapper owns defaults.
 * Owns the discount value (a percentage or an amount by type), the store-clock schedule,
 * and the scope pickers; `stackable` is never sent because the engine ignores it.
 */
export function PromotionForm({ endpoint, oldData }: PromotionFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(oldData);
  const form = useForm<PromotionFormValues>({ defaultValues: mapPromotionToFormValues(oldData) });
  const type = form.watch("type");

  return (
    <CustomForm<PromotionFormValues, typeof endpoint>
      form={form}
      mode={isEdit ? "edit" : "create"}
      sections={sections(type, oldData, form.getValues)}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      transformValues={(values) => promotionToBody(values, isEdit)}
      submitButtonText={isEdit ? "Save promotion" : "Create promotion"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        if (isEdit) {
          form.reset(mapPromotionToFormValues(saved));
          toast.success("Promotion saved");
        } else {
          toast.success(`${displayName(saved.name) || saved.code || "Promotion"} created`);
          router.push(AppRoute.PROMOTIONS);
        }
      }}
    />
  );
}
