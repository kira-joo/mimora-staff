"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { updateFulfilmentSettingsEndpoint, type Carrier } from "src/api/fulfilment-settings.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { useActionKeys } from "src/common/feedback/idempotency-key";
import { runAction } from "src/common/feedback/run-action";
import { usePermission } from "src/features/auth/use-permission";
import { MAX_CARRIERS, TRACKING_PLACEHOLDER, carrierListProblems, resolveTrackingUrl, validateUrlTemplate } from "src/server/fulfilment/carrier-tracking";

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

/**
 * The carriers staff can pick when an order ships: a name and a link pattern containing `{tracking}`. When a tracking
 * number is entered on an order, the carrier's name and the resolved link are copied onto the order — so changing or
 * removing a carrier here never changes a link a customer already has.
 *
 * The rules (https only, the placeholder after the host, unique keys) are the server's own functions, so the form
 * says what the API would; the API still checks.
 */
export function CarriersEditor({ initial }: { initial: Carrier[] }) {
  const can = usePermission();
  const queryClient = useQueryClient();
  const keys = useActionKeys();
  const canUpdate = can(AppPermission.FULFILMENT_SETTINGS.UPDATE);
  const [carriers, setCarriers] = useState<Carrier[]>(initial);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const problems = carrierListProblems(carriers);
  const problemFor = (field: string) => (showErrors ? problems.find((problem) => problem.field === field)?.messages[0] : undefined);
  const change = (index: number, patch: Partial<Carrier>) => setCarriers((current) => current.map((carrier, i) => (i === index ? { ...carrier, ...patch } : carrier)));
  const dirty = JSON.stringify(carriers) !== JSON.stringify(initial);

  async function save() {
    setShowErrors(true);
    if (problems.length > 0) return;
    setSaving(true);
    const scope = `carriers:${JSON.stringify(carriers)}`;
    const ok = await runAction(() => requester(updateFulfilmentSettingsEndpoint, { body: { carriers }, headers: keys.headers(scope) }), "Carriers saved");
    setSaving(false);
    if (ok) {
      keys.release(scope);
      await queryClient.invalidateQueries();
    }
  }

  return (
    <section aria-labelledby="carriers-heading" className="mt-8 border border-[var(--st-line)] bg-[var(--st-surface)] p-5">
      <h2 id="carriers-heading" className="text-[16px] font-semibold">
        Carriers
      </h2>
      <p className="mt-1 text-[14px] text-[var(--st-ink-muted)]">
        The carriers you can choose when marking an order shipped. The tracking link must be https and contain <code className="st-figure break-all">{TRACKING_PLACEHOLDER}</code> where the number goes, for example{" "}
        <code className="st-figure break-all">https://carrier.example/track/{TRACKING_PLACEHOLDER}</code>.
      </p>

      {carriers.length === 0 ? <p className="mt-4 text-[var(--st-ink-muted)]">No carriers yet — orders can still be shipped, just without a tracking number.</p> : null}

      <ul className="mt-4 flex flex-col gap-4">
        {carriers.map((carrier, index) => {
          const preview = validateUrlTemplate(carrier.urlTemplate) ? undefined : resolveTrackingUrl(carrier.urlTemplate, "123456789");
          return (
            <li key={index} className="grid gap-3 border border-[var(--st-line)] p-4 md:grid-cols-[1fr_1fr_auto]">
              <CustomInput
                label="Name"
                value={carrier.name}
                maxLength={80}
                disabled={!canUpdate}
                error={problemFor(`carriers.${index}.name`)}
                onChange={(event) => {
                  const name = event.target.value;
                  // The key is a stable handle, derived from the first name typed; renaming later does not change it.
                  change(index, { name, ...(carrier.key === "" || carrier.key === slugify(carrier.name) ? { key: slugify(name) } : {}) });
                }}
              />
              <CustomInput label="Key" dir="ltr" value={carrier.key} maxLength={32} disabled={!canUpdate} description="Lowercase letters, digits, hyphens." error={problemFor(`carriers.${index}.key`)} onChange={(event) => change(index, { key: event.target.value })} />
              {canUpdate ? (
                <div className="flex items-end">
                  <CustomButton variant="outline" aria-label={`Remove ${carrier.name || "carrier"}`} onClick={() => setCarriers((current) => current.filter((_, i) => i !== index))}>
                    <Trash2 aria-hidden="true" className="size-4" />
                  </CustomButton>
                </div>
              ) : null}
              <div className="md:col-span-3">
                <CustomInput
                  label="Tracking link"
                  dir="ltr"
                  value={carrier.urlTemplate}
                  maxLength={500}
                  disabled={!canUpdate}
                  placeholder={`https://carrier.example/track/${TRACKING_PLACEHOLDER}`}
                  error={problemFor(`carriers.${index}.urlTemplate`)}
                  onChange={(event) => change(index, { urlTemplate: event.target.value })}
                />
                {preview ? (
                  <p className="mt-1 break-all text-[13px] text-[var(--st-ink-muted)]">
                    For tracking number 123456789: <bdi dir="ltr" className="st-figure">{preview}</bdi>
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {canUpdate ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <CustomButton variant="outline" disabled={carriers.length >= MAX_CARRIERS} onClick={() => setCarriers((current) => [...current, { key: "", name: "", urlTemplate: "" }])}>
            <Plus aria-hidden="true" className="size-4" />
            Add carrier
          </CustomButton>
          <CustomButton onClick={save} loading={saving} disabled={!dirty}>
            Save carriers
          </CustomButton>
        </div>
      ) : null}
    </section>
  );
}
