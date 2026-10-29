"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type CustomFieldConfig, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { useForm } from "react-hook-form";
import {
  updateFulfilmentSettingsEndpoint,
  type FulfilmentSettings,
  type FulfilmentSettingsInput,
  type ShippingFeeMode,
  type TaxMode,
} from "src/api/fulfilment-settings.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { usePermission } from "src/features/auth/use-permission";
import { inputField, moneyField, wholeNumberField } from "./fulfilment-fields";
import { TIME_PATTERN } from "./fulfilment-values";

/** The form holds what the inputs hold (strings); `toBody` converts once, at submit. */
interface SettingsFormValues {
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  defaultDispatchLeadDays: string;
  cutoffTime: string;
  maxDaysAhead: string;
  orderMinimum: string;
  shippingFeeMode: ShippingFeeMode;
  flatShippingFee: string;
  allowGuestCheckout: boolean;
  taxMode: TaxMode;
  taxRate: string;
  customerCancelWindowMinutes: string;
  returnWindowDays: string;
}

const RATE_PATTERN = /^\d+(\.\d+)?$/;

/** The flat fee only means something in FLAT mode, so it only shows then. */
function onlyWhenFlat(field: CustomFieldConfig<SettingsFormValues>): CustomFieldConfig<SettingsFormValues> {
  return { ...field, render: (args) => (args.form.watch("shippingFeeMode") === "FLAT" ? field.render(args) : null) };
}

const SECTIONS: FormSection<SettingsFormValues>[] = [
  {
    title: "How orders are fulfilled",
    description: "Switch either off to be delivery-only or pickup-only. With both off the store cannot take orders.",
    columns: 1,
    fields: [
      { type: FieldType.SWITCH, name: "deliveryEnabled", label: "Delivery", description: "Customers can have orders delivered to a zone." },
      { type: FieldType.SWITCH, name: "pickupEnabled", label: "Pickup", description: "Customers can collect orders from a pickup location." },
    ],
  },
  {
    title: "Dispatch and scheduling",
    layout: "grid",
    columns: 2,
    fields: [
      wholeNumberField<SettingsFormValues>({ name: "defaultDispatchLeadDays", label: "Dispatch lead time (days)", required: true, min: 0, description: "Days between an order and its dispatch." }),
      inputField<SettingsFormValues>({
        name: "cutoffTime",
        label: "Daily cutoff",
        placeholder: "18:00",
        dir: "ltr",
        description: "24-hour HH:mm, store time. Orders after it count from the next day. Leave empty for no cutoff.",
        rules: { validate: (value) => (value === "" || value === undefined || value === null || TIME_PATTERN.test(String(value)) ? true : 'Use 24-hour HH:mm, like "18:00".') },
      }),
      wholeNumberField<SettingsFormValues>({ name: "maxDaysAhead", label: "Booking window (days)", required: true, min: 1, description: "The furthest day ahead, counted from today in the store's time zone, that an order may promise for delivery or pickup. If the earliest date is beyond it (a long closure, a slow zone), the order cannot be placed." }),
    ],
  },
  {
    title: "Pricing and shipping",
    layout: "grid",
    columns: 2,
    fields: [
      moneyField<SettingsFormValues>({ name: "orderMinimum", label: "Order minimum", allowBlank: true, description: "Store-wide minimum, and the fallback for zones without their own. Leave empty for none." }),
      {
        type: FieldType.SELECT,
        name: "shippingFeeMode",
        label: "Shipping fee",
        options: [
          { value: "BY_ZONE", label: "By delivery zone" },
          { value: "FLAT", label: "One flat fee" },
        ],
      },
      onlyWhenFlat(moneyField<SettingsFormValues>({ name: "flatShippingFee", label: "Flat shipping fee", allowBlank: true, description: "Charged on every delivery order. Leave empty or enter 0 for free shipping." })),
      {
        type: FieldType.SELECT,
        name: "taxMode",
        label: "Tax",
        options: [
          { value: "ADDED", label: "Added to prices" },
          { value: "INCLUDED", label: "Included in prices" },
        ],
      },
      inputField<SettingsFormValues>({
        name: "taxRate",
        label: "Tax rate (%)",
        required: true,
        inputMode: "decimal",
        dir: "ltr",
        description: "Between 0 and 100.",
        rules: { validate: (value) => (RATE_PATTERN.test(String(value ?? "")) && Number(value) <= 100 ? true : "Enter a rate between 0 and 100.") },
      }),
    ],
  },
  {
    title: "Checkout and returns",
    layout: "grid",
    columns: 2,
    fields: [
      { type: FieldType.SWITCH, name: "allowGuestCheckout", label: "Guest checkout", description: "Customers can order without an account.", colSpan: 2 },
      wholeNumberField<SettingsFormValues>({ name: "customerCancelWindowMinutes", label: "Self-cancel window (minutes)", required: true, min: 0, description: "How long after ordering a customer may cancel on their own." }),
      wholeNumberField<SettingsFormValues>({ name: "returnWindowDays", label: "Return window (days)", required: true, min: 0, description: "How long after delivery a return can be opened." }),
    ],
  },
];

function toValues(settings: FulfilmentSettings): SettingsFormValues {
  return {
    deliveryEnabled: settings.deliveryEnabled,
    pickupEnabled: settings.pickupEnabled,
    defaultDispatchLeadDays: String(settings.defaultDispatchLeadDays),
    cutoffTime: settings.cutoffTime ?? "",
    maxDaysAhead: String(settings.maxDaysAhead),
    orderMinimum: settings.orderMinimum ?? "",
    shippingFeeMode: settings.shippingFeeMode,
    flatShippingFee: settings.flatShippingFee ?? "",
    allowGuestCheckout: settings.allowGuestCheckout,
    taxMode: settings.tax.mode,
    taxRate: String(settings.tax.rate),
    customerCancelWindowMinutes: String(settings.customerCancelWindowMinutes),
    returnWindowDays: String(settings.returnWindowDays),
  };
}

/** A blank optional setting is sent as null, which the API reads as "clear it" — this form always edits the saved settings. */
function blankToNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

function toBody(values: SettingsFormValues): FulfilmentSettingsInput {
  return {
    deliveryEnabled: values.deliveryEnabled,
    pickupEnabled: values.pickupEnabled,
    defaultDispatchLeadDays: Number(values.defaultDispatchLeadDays),
    cutoffTime: blankToNull(values.cutoffTime),
    maxDaysAhead: Number(values.maxDaysAhead),
    orderMinimum: blankToNull(values.orderMinimum),
    shippingFeeMode: values.shippingFeeMode,
    flatShippingFee: blankToNull(values.flatShippingFee),
    allowGuestCheckout: values.allowGuestCheckout,
    tax: { mode: values.taxMode, rate: Number(values.taxRate) },
    customerCancelWindowMinutes: Number(values.customerCancelWindowMinutes),
    returnWindowDays: Number(values.returnWindowDays),
  };
}

/**
 * The singleton settings form. Saving stays on the page and re-baselines the
 * form on what the server returned, so the dirty guard clears. A role with
 * only Read sees the values, disabled, and no save button.
 */
export function FulfilmentSettingsForm({ settings }: { settings: FulfilmentSettings }) {
  const queryClient = useQueryClient();
  const can = usePermission();
  const canUpdate = can(AppPermission.FULFILMENT_SETTINGS.UPDATE);
  const form = useForm<SettingsFormValues>({ defaultValues: toValues(settings) });

  return (
    <fieldset disabled={!canUpdate} className="min-w-0 border-0 p-0">
      <CustomForm<SettingsFormValues, typeof updateFulfilmentSettingsEndpoint>
        form={form}
        mode="edit"
        sections={SECTIONS}
        submitEndpoint={updateFulfilmentSettingsEndpoint}
        transformValues={toBody}
        submitButtonText="Save settings"
        hideDefaultActions={!canUpdate}
        warnOnUnsavedChanges
        onSuccess={(saved) => {
          void queryClient.invalidateQueries();
          form.reset(toValues(saved));
          toast.success("Fulfilment settings saved");
        }}
      />
    </fieldset>
  );
}
