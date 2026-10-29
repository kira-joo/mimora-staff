"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomForm, FieldType, FormInput, FormSelect, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { CustomCheckbox } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { PageShell, QueryState, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { Info } from "lucide-react";
import { useMemo } from "react";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { getNotificationSettingsEndpoint, updateNotificationSettingsEndpoint, type NotificationChannel, type NotificationSettings } from "src/api/settings.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { usePermission } from "src/features/auth/use-permission";
import { notificationEventOptions } from "./notification-events";
import { notificationsToForm, toNotificationBody, type NotificationFormValues } from "./settings-bodies";
import { AddRowButton, ReadOnlyNotice, RowFrame, SettingsNote } from "./settings-fields";

type Form = NotificationFormValues;

/** `ArrayMaxSize(50)` on the DTO. */
const MAX_EVENTS = 50;

const CHANNELS: { value: NotificationChannel; label: string }[] = [
  { value: "EMAIL", label: "Email" },
  { value: "SMS", label: "SMS" },
];

function EventRow({ form, index, disabled, onRemove }: { form: UseFormReturn<Form>; index: number; disabled: boolean; onRemove: () => void }) {
  const p = `events.${index}` as const;
  const event = form.watch(`${p}.event`);
  const rows = form.watch("events");
  const options = notificationEventOptions(event ?? "", rows.filter((_, i) => i !== index).map((row) => row.event));
  return (
    <RowFrame title={options.find((option) => option.value === event)?.label ?? (event || `Event ${index + 1}`)} disabled={disabled} onRemove={onRemove}>
      <FormSelect
        control={form.control}
        name={`${p}.event`}
        label="Event"
        description="The order event this rule applies to. Only events that send a customer email are listed."
        options={options}
        placeholder="Choose an event"
        disabled={disabled}
        rules={{ required: "Choose an event" }}
      />
      <Controller
        control={form.control}
        name={`${p}.channels`}
        render={({ field }) => (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium text-[var(--st-ink)]">Send by</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {CHANNELS.map((channel) => (
                <CustomCheckbox
                  key={channel.value}
                  label={channel.label}
                  checked={field.value.includes(channel.value)}
                  disabled={disabled}
                  onChange={(event) => field.onChange(event.target.checked ? [...field.value, channel.value] : field.value.filter((c) => c !== channel.value))}
                />
              ))}
            </div>
          </fieldset>
        )}
      />
      <FormInput
        control={form.control}
        name={`${p}.recipientRoles`}
        label="Recipient roles"
        description="Comma-separated role identifiers, e.g. owner, manager."
        dir="ltr"
        disabled={disabled}
      />
    </RowFrame>
  );
}

function EventList({ value: events, onChange, form, disabled }: { value: Form["events"]; onChange: (value: Form["events"]) => void; form: UseFormReturn<Form>; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {events.length === 0 ? <SettingsNote>No notification rules yet.</SettingsNote> : null}
      {events.map((_, index) => (
        <EventRow key={index} form={form} index={index} disabled={disabled} onRemove={() => onChange(form.getValues("events").filter((__, i) => i !== index))} />
      ))}
      {disabled ? null : (
        <AddRowButton disabled={events.length >= MAX_EVENTS} onClick={() => onChange([...form.getValues("events"), { event: "", channels: [], recipientRoles: "" }])}>
          Add a rule
        </AddRowButton>
      )}
    </div>
  );
}

function buildSections(readOnly: boolean): FormSection<Form>[] {
  return [
    {
      title: "Notification rules",
      description: "Per event: which channels it goes out on and which roles receive it.",
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "events",
          render: ({ field, form }) => <EventList value={(field.value as Form["events"] | undefined) ?? []} onChange={field.onChange} form={form} disabled={readOnly} />,
        },
      ],
    },
  ];
}

const SECTIONS_EDIT = buildSections(false);
const SECTIONS_READ_ONLY = buildSections(true);

function NotificationForm({ settings, canUpdate }: { settings: NotificationSettings; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const form = useForm<Form>({ defaultValues: notificationsToForm(settings) });
  const sections = useMemo(() => (canUpdate ? SECTIONS_EDIT : SECTIONS_READ_ONLY), [canUpdate]);

  return (
    <CustomForm<Form, typeof updateNotificationSettingsEndpoint>
      form={form}
      mode="edit"
      sections={sections}
      submitEndpoint={updateNotificationSettingsEndpoint}
      transformValues={toNotificationBody}
      submitButtonText="Save notification settings"
      hideDefaultActions={!canUpdate}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        form.reset(notificationsToForm(saved));
        void queryClient.invalidateQueries();
        toast.success("Notification settings saved");
      }}
    />
  );
}

/** Per-event channels and recipient roles. Email goes out over the SMTP provider the deployment configures; SMS has no transport, which the screen says plainly. */
export function NotificationSettingsView() {
  const can = usePermission();
  const canUpdate = can(AppPermission.NOTIFICATION_SETTINGS.UPDATE);
  const query = useRequesterQuery({ endpoint: getNotificationSettingsEndpoint });
  return (
    <QueryState query={query} entityName="notification settings">
      {(settings) => (
        <PageShell title="Notification settings" description="Who is told about what, and how." maxWidth="3xl">
          {canUpdate ? null : <ReadOnlyNotice />}
          <p role="note" className="mb-4 flex items-start gap-2 border border-[var(--st-line)] bg-[var(--st-surface)] p-3 text-[var(--st-ink-muted)]">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>Email is sent only for the events you add here, and only when the deployment has an SMTP provider configured; otherwise the server logs each message by template name instead. SMS has no provider connected, so ticking it sends nothing.</span>
          </p>
          <NotificationForm key={settings.updatedAt} settings={settings} canUpdate={canUpdate} />
        </PageShell>
      )}
    </QueryState>
  );
}
