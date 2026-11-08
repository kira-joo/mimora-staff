"use client";

import { DialogBody, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomForm, FieldType, type FormFieldConfig, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import type { OptionAxis, Product } from "src/api/products.endpoints";
import type { createVariantEndpoint, updateVariantEndpoint, Variant } from "src/api/variants.endpoints";
import { MONEY_INPUT_MESSAGE, MONEY_INPUT_PATTERN } from "src/common/format/money-input";
import { displayName } from "../catalog-display";
import { MEASUREMENT, UNIT_OPTIONS, WHOLE_NUMBER, createVariantBody, variantBody, mapVariantToFormValues, type VariantFormValues } from "./variant-values";

const money = (label: string, required = false): FormFieldConfig<VariantFormValues>["rules"] => ({
  required: required ? `${label} is required.` : false,
  pattern: { value: MONEY_INPUT_PATTERN, message: MONEY_INPUT_MESSAGE },
});
const whole = { pattern: { value: WHOLE_NUMBER, message: "Enter a whole number, like 0 or 12." } };
const measurement = { pattern: { value: MEASUREMENT, message: "Enter a number, like 250 or 12.5." } };

function sections(axes: readonly OptionAxis[], creating: boolean): FormSection<VariantFormValues>[] {
  const optionFields: FormFieldConfig<VariantFormValues>[] = axes.map((axis, index) => ({
    type: FieldType.INPUT,
    name: `optionValues.${index}.value` as const,
    label: displayName(axis.name) || axis.key,
    rules: { required: true, maxLength: 200 },
  }));

  return [
    {
      title: "Identity",
      columns: 2,
      fields: [{ type: FieldType.INPUT, name: "sku", label: "SKU", description: "Unique across the store.", rules: { required: true, maxLength: 100 }, colSpan: "full" }, ...optionFields],
    },
    {
      title: "Price",
      description: "In the store's currency. The compare-at price shows struck through.",
      columns: 2,
      fields: [
        { type: FieldType.INPUT, name: "price", label: "Price", rules: money("Price", true) },
        { type: FieldType.INPUT, name: "compareAtPrice", label: "Compare-at price", rules: money("Compare-at price") },
        { type: FieldType.INPUT, name: "costPrice", label: "Cost", description: "Never shown to customers.", rules: money("Cost") },
      ],
    },
    {
      title: "Stock",
      description: creating ? "The opening count. After this, stock changes through Inventory, which keeps a record of each movement." : "Stock changes through Inventory, which keeps a record of each movement.",
      columns: 2,
      fields: [
        ...(creating ? [{ type: FieldType.INPUT, name: "stock", label: "Opening stock", inputType: "number", rules: { required: true, ...whole } } as FormFieldConfig<VariantFormValues>] : []),
        { type: FieldType.INPUT, name: "lowStockThreshold", label: "Low-stock alert at", description: "Leave empty to use the store default.", inputType: "number", rules: whole },
        {
          type: FieldType.SELECT,
          name: "backorderPolicy",
          label: "When it runs out",
          description: creating ? "\"Store default\" follows Inventory settings as they are today; the choice is then saved on this variant." : undefined,
          options: [
            ...(creating ? [{ value: "DEFAULT", label: "Store default" }] : []),
            { value: "DENY", label: "Stop selling at zero" },
            { value: "CONTINUE_SELLING", label: "Keep selling (backorder)" },
          ],
        },
      ],
    },
    {
      title: "Packaging and shipping",
      columns: 2,
      fields: [
        { type: FieldType.SELECT, name: "unitOfMeasure", label: "Sold as", options: UNIT_OPTIONS },
        { type: FieldType.INPUT, name: "unitsPerSale", label: "Units per sale", inputType: "number", rules: { required: true, ...whole, min: 1 } },
        { type: FieldType.INPUT, name: "weight", label: "Weight (g)", rules: measurement },
        { type: FieldType.INPUT, name: "length", label: "Length (mm)", rules: measurement },
        { type: FieldType.INPUT, name: "width", label: "Width (mm)", rules: measurement },
        { type: FieldType.INPUT, name: "height", label: "Height (mm)", rules: measurement },
      ],
    },
  ];
}

type VariantDrawerProps = DialogContentProps<boolean> & {
  product: Product;
  endpoint: typeof createVariantEndpoint | typeof updateVariantEndpoint;
  oldData?: Variant;
};

/**
 * Create or edit one variant, in a centred dialog over the product. The opener picks
 * the endpoint. A create sends the product and the opening stock; an edit
 * never sends stock — that moves through Inventory. The API refuses a
 * duplicate SKU, a duplicate option combination, and option values that
 * don't match the product's options; each message lands on the form.
 */
export function VariantDrawer({ product, endpoint, oldData, titleId, descriptionId, resolve }: VariantDrawerProps) {
  const isEdit = Boolean(oldData);

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={oldData ? <span className="st-figure">{oldData.sku}</span> : "New variant"}
      description={<span dir="auto">{displayName(product.name)}</span>}
    >
      <CustomForm<VariantFormValues, typeof endpoint>
        mode={isEdit ? "edit" : "create"}
        sections={sections(product.optionAxes, !isEdit)}
        defaultValues={mapVariantToFormValues(product.optionAxes, oldData)}
        submitEndpoint={endpoint}
        submitParams={oldData ? { id: oldData._id } : undefined}
        transformValues={(values) => (isEdit ? variantBody(values) : createVariantBody(product._id, values))}
        submitButtonText={isEdit ? "Save variant" : "Create variant"}
        onSuccess={(saved) => {
          toast.success(`${saved.sku} ${isEdit ? "saved" : "created"}`);
          resolve(true);
        }}
      />
    </DialogBody>
  );
}
