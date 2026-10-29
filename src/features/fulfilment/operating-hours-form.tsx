"use client";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { useForm } from "react-hook-form";
import { updateOperatingHoursEndpoint, type HoursException, type OperatingHours, type WeeklyHours } from "src/api/fulfilment-settings.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { usePermission } from "src/features/auth/use-permission";
import { fromExceptionsForm, fromWeekForm, toExceptionsForm, toWeekForm, validateExceptions, validateWeek } from "./fulfilment-values";
import { ExceptionsEditor, WeekEditor } from "./hours-editors";

interface HoursFormValues {
  weekly: WeeklyHours[];
  exceptions: HoursException[];
}

const SECTIONS: FormSection<HoursFormValues>[] = [
  {
    title: "Weekly hours",
    description: "Times are the store's local time. Switch a day off to close it; add a second range for a break.",
    columns: 1,
    fields: [
      {
        type: FieldType.CUSTOM,
        name: "weekly",
        rules: { validate: (value) => validateWeek(value as WeeklyHours[]) ?? true },
        render: ({ field, error }) => (
          <div className="flex flex-col gap-2">
            <WeekEditor value={field.value as WeeklyHours[]} onChange={field.onChange} />
            {error ? (
              <p role="alert" className="text-[var(--st-status-danger)]">
                {error}
              </p>
            ) : null}
          </div>
        ),
      },
    ],
  },
  {
    title: "Exceptions",
    description: "A date here replaces that day's weekly hours — a public holiday, or a one-off closure.",
    columns: 1,
    fields: [
      {
        type: FieldType.CUSTOM,
        name: "exceptions",
        rules: { validate: (value) => validateExceptions(value as HoursException[]) ?? true },
        render: ({ field, error }) => (
          <div className="flex flex-col gap-2">
            <ExceptionsEditor value={field.value as HoursException[]} onChange={field.onChange} />
            {error ? (
              <p role="alert" className="text-[var(--st-status-danger)]">
                {error}
              </p>
            ) : null}
          </div>
        ),
      },
    ],
  },
];

function toValues(hours: OperatingHours): HoursFormValues {
  return { weekly: toWeekForm(hours.weekly), exceptions: toExceptionsForm(hours.exceptions) };
}

function toBody(values: HoursFormValues): OperatingHours {
  return { weekly: fromWeekForm(values.weekly), exceptions: fromExceptionsForm(values.exceptions) };
}

/** The singleton hours form: saving stays on the page and re-baselines on what the server returned. Read-only roles see it disabled. */
export function OperatingHoursForm({ hours }: { hours: OperatingHours }) {
  const queryClient = useQueryClient();
  const can = usePermission();
  const canUpdate = can(AppPermission.OPERATING_HOURS.UPDATE);
  const form = useForm<HoursFormValues>({ defaultValues: toValues(hours) });

  return (
    <fieldset disabled={!canUpdate} className="min-w-0 border-0 p-0">
      <CustomForm<HoursFormValues, typeof updateOperatingHoursEndpoint>
        form={form}
        mode="edit"
        sections={SECTIONS}
        submitEndpoint={updateOperatingHoursEndpoint}
        transformValues={toBody}
        submitButtonText="Save hours"
        hideDefaultActions={!canUpdate}
        warnOnUnsavedChanges
        onSuccess={(saved) => {
          void queryClient.invalidateQueries();
          form.reset(toValues(saved));
          toast.success("Operating hours saved");
        }}
      />
    </fieldset>
  );
}
