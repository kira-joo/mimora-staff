"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { useRouter } from "next/navigation";
import type { createPickupLocationEndpoint, updatePickupLocationEndpoint, PickupLocation, PickupLocationInput } from "src/api/pickup-locations.endpoints";
import type { LocalizedText } from "src/api/brands.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { inputField } from "./fulfilment-fields";

/** Coordinates are two text inputs here; `toBody` sends them as numbers, and only when both are filled. */
interface LocationFormValues {
  name: LocalizedText;
  address: LocalizedText;
  phone: string;
  lat: string;
  lng: string;
  active: boolean;
}

const COORDINATE = /^-?\d+(\.\d+)?$/;

function coordinateRule(label: string, limit: number, other: "lat" | "lng") {
  return {
    validate: (value: unknown, values: Record<string, unknown>) => {
      const text = String(value ?? "").trim();
      const otherText = String(values[other] ?? "").trim();
      if (text === "") return otherText === "" ? true : `${label} is needed too — or clear both.`;
      if (!COORDINATE.test(text)) return `${label} must be a number.`;
      return Math.abs(Number(text)) <= limit ? true : `${label} must be between -${limit} and ${limit}.`;
    },
  };
}

const SECTIONS: FormSection<LocationFormValues>[] = [
  {
    title: "Location",
    description: "Customers see the name and address when they choose pickup.",
    columns: 1,
    fields: [
      { type: FieldType.LOCALIZED_INPUT, name: "name", label: "Name" },
      { type: FieldType.LOCALIZED_TEXTAREA, name: "address", label: "Address", rows: 3 },
      inputField<LocationFormValues>({ name: "phone", label: "Phone", type: "tel", inputMode: "tel", dir: "ltr", required: true, description: "Shown to the customer for questions about collecting." }),
    ],
  },
  {
    title: "Map position",
    description: "Optional. Leave both blank if the location has no coordinates.",
    layout: "grid",
    columns: 2,
    fields: [
      inputField<LocationFormValues>({ name: "lat", label: "Latitude", inputMode: "decimal", dir: "ltr", placeholder: "30.0444", rules: coordinateRule("Latitude", 90, "lng") }),
      inputField<LocationFormValues>({ name: "lng", label: "Longitude", inputMode: "decimal", dir: "ltr", placeholder: "31.2357", rules: coordinateRule("Longitude", 180, "lat") }),
    ],
  },
  {
    title: "Availability",
    columns: 1,
    fields: [{ type: FieldType.SWITCH, name: "active", label: "Active", description: "An inactive location is not offered at checkout." }],
  },
];

/** API shape → form values (coordinates split into the two text inputs); no location → the create defaults. */
export function mapPickupLocationToFormValues(oldData?: PickupLocation): LocationFormValues {
  return {
    name: oldData?.name ?? { ar: "", en: "" },
    address: oldData?.address ?? { ar: "", en: "" },
    phone: oldData?.phone ?? "",
    lat: oldData?.coordinates ? String(oldData.coordinates.lat) : "",
    lng: oldData?.coordinates ? String(oldData.coordinates.lng) : "",
    active: oldData?.active ?? true,
  };
}

/** Form text → wire body. Coordinates go only as a complete pair; both blank omits them on a create and removes stored ones on an edit. */
function toBody(values: LocationFormValues, isEdit: boolean): PickupLocationInput {
  const lat = values.lat.trim();
  const lng = values.lng.trim();
  return {
    name: values.name,
    address: values.address,
    phone: values.phone.trim(),
    coordinates: lat !== "" && lng !== "" ? { lat: Number(lat), lng: Number(lng) } : isEdit ? null : undefined,
    active: values.active,
  };
}

export interface PickupLocationFormProps {
  endpoint: typeof createPickupLocationEndpoint | typeof updatePickupLocationEndpoint;
  oldData?: PickupLocation;
}

/** Owns the coordinates pair — two inputs on the form, one optional object on the wire (`toBody`). */
export function PickupLocationForm({ endpoint, oldData }: PickupLocationFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = Boolean(oldData);

  return (
    <CustomForm<LocationFormValues, typeof endpoint>
      mode={isEdit ? "edit" : "create"}
      sections={SECTIONS}
      defaultValues={mapPickupLocationToFormValues(oldData)}
      submitEndpoint={endpoint}
      submitParams={oldData ? { id: oldData._id } : undefined}
      transformValues={(values) => toBody(values, isEdit)}
      submitButtonText={isEdit ? "Save location" : "Create location"}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        void queryClient.invalidateQueries();
        toast.success(isEdit ? "Pickup location saved" : `${saved.name.en || saved.name.ar || "Location"} created`);
        router.push(AppRoute.PICKUP_LOCATIONS);
      }}
    />
  );
}
