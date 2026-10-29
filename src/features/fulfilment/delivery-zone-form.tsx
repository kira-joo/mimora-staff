"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { useRouter } from "next/navigation";
import type { createDeliveryZoneEndpoint, updateDeliveryZoneEndpoint, DeliveryZone, DeliveryZoneInput } from "src/api/delivery-zones.endpoints";
import type { LocalizedText } from "src/api/brands.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { linesField, moneyField, wholeNumberField } from "./fulfilment-fields";

/** The form holds what the inputs hold (strings); `toBody` converts once, at submit. */
interface ZoneFormValues {
  name: LocalizedText;
  areas: string[];
  fee: string;
  minimumOrder: string;
  leadDays: string;
  active: boolean;
}

const SECTIONS: FormSection<ZoneFormValues>[] = [
  {
    title: "Zone",
    description: "A customer is matched to a zone by the governorate on their address, which must equal the zone's English name. The zone's name is what they see.",
    columns: 1,
    fields: [
      { type: FieldType.LOCALIZED_INPUT, name: "name", label: "Name" },
      linesField<ZoneFormValues>({
        name: "areas",
        label: "Areas (for reference)",
        description: "Informational only: a note of the districts this zone covers. Customers are not matched by area, so nothing here changes who can order or what they pay. One per line; up to 500, each at most 200 characters.",
        placeholder: "Nasr City\nمدينة نصر",
        rows: 8,
      }),
    ],
  },
  {
    title: "Fee and lead time",
    layout: "grid",
    columns: 2,
    fields: [
      moneyField<ZoneFormValues>({ name: "fee", label: "Delivery fee", required: true, description: "Charged for orders to this zone. Enter 0 for free delivery." }),
      moneyField<ZoneFormValues>({ name: "minimumOrder", label: "Minimum order", allowBlank: true, description: "Smallest order this zone accepts. Leave empty to use the store-wide minimum; enter 0 for no minimum in this zone." }),
      wholeNumberField<ZoneFormValues>({ name: "leadDays", label: "Lead time (days)", required: true, min: 0, description: "Days from dispatch to delivery." }),
    ],
  },
  {
    title: "Availability",
    columns: 1,
    fields: [{ type: FieldType.SWITCH, name: "active", label: "Active", description: "An inactive zone is not offered at checkout." }],
  },
];

/** API shape → form values (numbers become the text the inputs hold); no zone → the create defaults. */
export function mapDeliveryZoneToFormValues(oldData?: DeliveryZone): ZoneFormValues {
  return {
    name: oldData?.name ?? { ar: "", en: "" },
    areas: oldData?.areas ?? [],
    fee: oldData?.fee ?? "",
    minimumOrder: oldData?.minimumOrder ?? "",
    leadDays: oldData ? String(oldData.leadDays) : "1",
    active: oldData?.active ?? true,
  };
}

/** Form text → wire body. A blank minimum is omitted on a create (none set) and sent as null on an edit, which removes it. */
function toBody(values: ZoneFormValues, isEdit: boolean): DeliveryZoneInput {
  return {
    name: values.name,
    areas: values.areas,
    fee: values.fee.trim(),
    minimumOrder: values.minimumOrder.trim() === "" ? (isEdit ? null : undefined) : values.minimumOrder.trim(),
    leadDays: Number(values.leadDays),
    active: values.active,
  };
}

export interface DeliveryZoneFormProps {
  endpoint: typeof createDeliveryZoneEndpoint | typeof updateDeliveryZoneEndpoint;
  oldData?: DeliveryZone;
}

/** Owns the areas editor, the money fields and the text → wire conversion (`toBody`). */
export function DeliveryZoneForm({ endpoint, oldData }: DeliveryZoneFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(oldData);

  return (
    <CustomForm<ZoneFormValues, typeof endpoint>
      mode={isEdit ? "edit" : "create"}
      sections={SECTIONS}
      defaultValues={mapDeliveryZoneToFormValues(oldData)}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      transformValues={(values) => toBody(values, isEdit)}
      submitButtonText={isEdit ? "Save zone" : "Create zone"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        toast.success(isEdit ? "Delivery zone saved" : `${saved.name.en || saved.name.ar || "Zone"} created`);
        router.push(AppRoute.DELIVERY_ZONES);
      }}
    />
  );
}
