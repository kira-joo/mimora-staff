"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomForm, FieldType, type FormSection } from "@kira-joo/frontend-toolkit-tailwind/forms";
import { PageShell, QueryState, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { getInventorySettingsEndpoint, updateInventorySettingsEndpoint, type InventoryPolicy, type InventorySettings } from "src/api/settings.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { usePermission } from "src/features/auth/use-permission";
import { WHOLE_NUMBER, disableFields } from "./settings-helpers";
import { ReadOnlyNotice } from "./settings-fields";

interface Form {
  lowStockThreshold: string;
  defaultInventoryPolicy: InventoryPolicy;
}

const toForm = (s: InventorySettings): Form => ({ lowStockThreshold: String(s.lowStockThreshold ?? 5), defaultInventoryPolicy: s.defaultInventoryPolicy ?? "DENY" });

function buildSections(readOnly: boolean): FormSection<Form>[] {
  return disableFields<Form>(
    [
      {
        title: "Stock rules",
        description: "Defaults for every variant. A variant can set its own threshold or policy.",
        columns: 1,
        fields: [
          {
            type: FieldType.INPUT,
            name: "lowStockThreshold",
            inputType: "number",
            label: "Low-stock threshold",
            description: "A variant at or below this many units is flagged as low stock.",
            rules: {
              required: "Enter a threshold",
              pattern: { value: WHOLE_NUMBER, message: "Enter a whole number, 0 or more" },
            },
          },
          {
            type: FieldType.RADIO_GROUP,
            name: "defaultInventoryPolicy",
            label: "When a variant runs out of stock",
            orientation: "vertical",
            options: [
              { value: "DENY", label: "Stop selling it at zero stock" },
              { value: "CONTINUE_SELLING", label: "Keep selling it past zero (backorder)" },
            ],
          },
        ],
      },
    ],
    readOnly,
  );
}

function InventoryForm({ settings, canUpdate }: { settings: InventorySettings; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const form = useForm<Form>({ defaultValues: toForm(settings) });
  const sections = useMemo(() => buildSections(!canUpdate), [canUpdate]);

  return (
    <CustomForm<Form, typeof updateInventorySettingsEndpoint>
      form={form}
      mode="edit"
      sections={sections}
      submitEndpoint={updateInventorySettingsEndpoint}
      transformValues={(v) => ({ lowStockThreshold: Number(v.lowStockThreshold), defaultInventoryPolicy: v.defaultInventoryPolicy })}
      submitButtonText="Save inventory settings"
      hideDefaultActions={!canUpdate}
      warnOnUnsavedChanges
      onSuccess={(saved) => {
        form.reset(toForm(saved));
        void queryClient.invalidateQueries();
        toast.success("Inventory settings saved");
      }}
    />
  );
}

/** Low-stock threshold and the default out-of-stock policy. Stock can never go below zero: "keep selling" skips the stock check, it does not allow negative stock. */
export function InventorySettingsView() {
  const can = usePermission();
  const canUpdate = can(AppPermission.INVENTORY_SETTINGS.UPDATE);
  const query = useRequesterQuery({ endpoint: getInventorySettingsEndpoint });
  return (
    <QueryState query={query} entityName="inventory settings">
      {(settings) => (
        <PageShell title="Inventory settings" description="When stock counts as low, and what happens at zero.">
          {canUpdate ? null : <ReadOnlyNotice />}
          <InventoryForm key={settings.updatedAt} settings={settings} canUpdate={canUpdate} />
        </PageShell>
      )}
    </QueryState>
  );
}
