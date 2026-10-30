"use client";

import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { useQueryClient } from "@tanstack/react-query";
import { useConfirm } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomForm, FieldType, FormInput, FormLocalizedTextarea, FormSwitch, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { PageShell, QueryState, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { getPaymentSettingsEndpoint, updatePaymentSettingsEndpoint, type PaymentMethod, type PaymentSettings } from "src/api/settings.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { usePermission } from "src/features/auth/use-permission";
import { WHOLE_NUMBER } from "./settings-helpers";
import { describePaymentChanges, emptyPaymentMethod, paymentToForm, toPaymentMethods, type PaymentFormValues } from "./settings-bodies";
import { AddRowButton, ReadOnlyNotice, RowFrame, SettingsNote } from "./settings-fields";

type Form = PaymentFormValues;

/** `ArrayMaxSize(20)` on the DTO. */
const MAX_METHODS = 20;

const WHOLE = { value: WHOLE_NUMBER, message: "Enter a whole number" };
const MINUTES = {
  pattern: WHOLE,
  validate: (value: unknown) => value === "" || Number(value) >= 1 || "Must be at least 1 minute",
};

function MethodRow({ form, index, disabled, onRemove }: { form: UseFormReturn<Form>; index: number; disabled: boolean; onRemove: () => void }) {
  const p = `methods.${index}` as const;
  const label = form.watch(`${p}.method`);
  const enabled = form.watch(`${p}.enabled`);
  return (
    <RowFrame title={label || `Method ${index + 1}`} disabled={disabled} onRemove={onRemove}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormInput
          control={form.control}
          name={`${p}.method`}
          label="Method key"
          description="The identifier orders record, e.g. COD or WALLET. Customers see the instructions below, not this."
          dir="ltr"
          controlClassName="st-figure"
          disabled={disabled}
          rules={{
            validate: (value: string) => {
              if (!value.trim()) return "Enter a method key";
              return form.getValues("methods").filter((m) => m.method.trim() === value.trim()).length <= 1 || "Another method already uses this key";
            },
          }}
        />
        <FormInput control={form.control} name={`${p}.order`} label="Display order" description="Lower numbers are listed first." dir="ltr" inputMode="numeric" controlClassName="st-figure" disabled={disabled} rules={{ pattern: WHOLE }} />
      </div>

      <FormSwitch control={form.control} name={`${p}.enabled`} label={enabled ? "Offered at checkout" : "Not offered at checkout"} disabled={disabled} />

      <fieldset className="flex flex-col gap-4 border-t border-[var(--st-line)] pt-4">
        <legend className="pe-2 font-medium text-[var(--st-ink)]">Where customers send money</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <FormInput control={form.control} name={`${p}.destination.accountName`} label="Account name" dir="auto" disabled={disabled} />
          <FormInput
            control={form.control}
            name={`${p}.destination.number`}
            label="Account or wallet number"
            description="An IBAN, account or phone number."
            dir="ltr"
            controlClassName="st-figure"
            disabled={disabled}
          />
          <FormInput control={form.control} name={`${p}.destination.handle`} label="Handle" description="A payment-app username or link, if any." dir="ltr" controlClassName="st-figure" disabled={disabled} />
        </div>
        <FormLocalizedTextarea control={form.control} name={`${p}.instructions`} label="Instructions shown to the customer" rows={3} disabled={disabled} />
      </fieldset>

      <div className="grid gap-4 border-t border-[var(--st-line)] pt-4 md:grid-cols-2">
        <FormSwitch control={form.control} name={`${p}.requiresProof`} label="Customer must upload proof of payment" disabled={disabled} className="md:col-span-2" />
        <FormInput
          control={form.control}
          name={`${p}.autoCancelMinutes`}
          label="Cancel unpaid orders after (minutes)"
          description="Blank means never."
          dir="ltr"
          inputMode="numeric"
          controlClassName="st-figure"
          disabled={disabled}
          rules={MINUTES}
        />
        <FormInput
          control={form.control}
          name={`${p}.verificationWindowMinutes`}
          label="Verify proof within (minutes)"
          description="Blank means no deadline."
          dir="ltr"
          inputMode="numeric"
          controlClassName="st-figure"
          disabled={disabled}
          rules={MINUTES}
        />
      </div>
    </RowFrame>
  );
}

function MethodList({ value: methods, onChange, form, disabled }: { value: Form["methods"]; onChange: (value: Form["methods"]) => void; form: UseFormReturn<Form>; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {methods.length === 0 ? <SettingsNote>No payment methods yet.</SettingsNote> : null}
      {methods.map((_, index) => (
        <MethodRow key={index} form={form} index={index} disabled={disabled} onRemove={() => onChange(form.getValues("methods").filter((__, i) => i !== index))} />
      ))}
      {disabled ? null : (
        <AddRowButton disabled={methods.length >= MAX_METHODS} onClick={() => onChange([...form.getValues("methods"), emptyPaymentMethod(methods.length)])}>
          Add a payment method
        </AddRowButton>
      )}
    </div>
  );
}

function buildSections(readOnly: boolean): FormSection<Form>[] {
  return [
    {
      title: "Payment methods",
      description: "What customers can pay with, and where they send the money. Each order keeps a copy of the destination it was placed with.",
      columns: 1,
      fields: [
        {
          type: FieldType.CUSTOM,
          name: "methods",
          render: ({ field, form }) => <MethodList value={(field.value as Form["methods"] | undefined) ?? []} onChange={field.onChange} form={form} disabled={readOnly} />,
        },
      ],
    },
  ];
}

const SECTIONS_EDIT = buildSections(false);
const SECTIONS_READ_ONLY = buildSections(true);

function PaymentForm({ settings, canUpdate }: { settings: PaymentSettings; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const form = useForm<Form>({ defaultValues: paymentToForm(settings.methods) });
  /** What is saved right now — the baseline the confirm compares against. */
  const [saved, setSaved] = useState<PaymentMethod[]>(settings.methods);

  /** The payment destination is audited and copied onto every order, so a save names what changes and asks first. */
  function confirmDestinationChange(values: Form): Promise<boolean> {
    const changes = describePaymentChanges(saved, toPaymentMethods(values));
    return confirm({
      title: "Change where customers send payment?",
      description: "New orders will use these payment details. Existing orders keep the destination they were placed with.",
      body: (
        <ul className="list-disc ps-5 text-[var(--st-ink)]">
          {changes.length ? changes.map((line) => <li key={line}>{line}</li>) : <li>No destination or availability changes.</li>}
        </ul>
      ),
      confirmLabel: "Save payment settings",
    });
  }

  return (
    <CustomForm<Form, typeof updatePaymentSettingsEndpoint>
      form={form}
      mode="edit"
      sections={canUpdate ? SECTIONS_EDIT : SECTIONS_READ_ONLY}
      submitEndpoint={updatePaymentSettingsEndpoint}
      transformValues={(values) => ({ methods: toPaymentMethods(values) })}
      confirmSubmit={confirmDestinationChange}
      submitButtonText="Save payment settings"
      hideDefaultActions={!canUpdate}
      warnOnUnsavedChanges
      onSuccess={(result) => {
        setSaved(result.methods);
        form.reset(paymentToForm(result.methods));
        void queryClient.invalidateQueries();
        toast.success("Payment settings saved");
      }}
    />
  );
}

/**
 * The payment destination customers send money to. It is audited and copied onto every order, so a save is
 * confirmed first (CustomForm's `confirmSubmit`).
 */
export function PaymentView() {
  const can = usePermission();
  const canUpdate = can(AppPermission.PAYMENT_SETTINGS.UPDATE);
  const query = useRequesterQuery({ endpoint: getPaymentSettingsEndpoint });
  return (
    <QueryState query={query} entityName="payment settings">
      {(settings) => (
        <PageShell title="Payment settings" description="Where customers send money, and how long they have to pay.">
          {canUpdate ? null : <ReadOnlyNotice />}
          <PaymentForm key={settings.updatedAt} settings={settings} canUpdate={canUpdate} />
        </PageShell>
      )}
    </QueryState>
  );
}
