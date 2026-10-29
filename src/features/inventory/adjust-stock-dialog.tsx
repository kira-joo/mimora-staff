"use client";

import { requester } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { DialogBody, useConfirm, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { CustomInput, CustomTextarea } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { CustomSelect } from "@kira-joo/frontend-toolkit-tailwind/select";
import { useState } from "react";
import { runAction } from "src/common/feedback/run-action";
import { adjustStockEndpoint, bulkAdjustStockEndpoint, type AdjustReason, type InventoryItem } from "src/api/inventory.endpoints";
import { parseDelta, previewStock } from "./stock-state";

export const REASON_OPTIONS: { value: AdjustReason; label: string }[] = [
  { value: "RECEIPT", label: "Stock received" },
  { value: "DAMAGE", label: "Damaged or lost" },
  { value: "ADJUSTMENT", label: "Count correction" },
];

export function variantLabel(item: InventoryItem): string {
  const name = item.productName.en || item.productName.ar;
  const options = item.optionValues.map((o) => o.value).join(" · ");
  return options ? `${name} (${options})` : name;
}

const DELTA_ERROR = "Enter a whole number other than zero, like 12 or -3.";

/** Single-variant adjustment. Resolves `true` once the server has applied it. */
export function AdjustStockDialog({ item, titleId, descriptionId, resolve, dismiss }: DialogContentProps<boolean> & { item: InventoryItem }) {
  const { confirm } = useConfirm();
  const [deltaText, setDeltaText] = useState("");
  const [reason, setReason] = useState<AdjustReason>("RECEIPT");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const delta = parseDelta(deltaText);
  const next = previewStock(item.stock, delta);

  async function submit() {
    if (delta === null) {
      setError(DELTA_ERROR);
      return;
    }
    if (delta < 0) {
      const ok = await confirm({
        title: `Remove ${Math.abs(delta)} from stock?`,
        description: `${variantLabel(item)} goes from ${item.stock} to ${item.stock + delta}. The server refuses it if stock would go below zero.`,
        confirmLabel: "Remove stock",
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    const ok = await runAction(
      () => requester(adjustStockEndpoint, { params: { id: item._id }, body: { delta, reason, note: note.trim() || undefined } }),
      `${item.sku}: stock adjusted`,
    );
    if (ok) resolve(true);
    else setBusy(false);
  }

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title="Adjust stock"
      description={<span dir="auto">{variantLabel(item)}</span>}
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss} disabled={busy}>
            Cancel
          </CustomButton>
          <CustomButton onClick={submit} loading={busy}>
            Apply adjustment
          </CustomButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[var(--st-ink-muted)]">
          SKU <span className="st-figure">{item.sku}</span> · current stock <span className="st-figure font-medium text-[var(--st-ink)]">{item.stock}</span>
        </p>
        <CustomInput
          label="Change"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="+12 or -3"
          description="Positive adds to stock, negative removes."
          value={deltaText}
          error={error}
          onChange={(event) => {
            setDeltaText(event.target.value);
            if (error) setError(undefined);
          }}
        />
        <p aria-live="polite" className="min-h-5 text-[var(--st-ink)]">
          {next === null ? null : (
            <>
              Stock will go from <span className="st-figure font-medium">{item.stock}</span> to <span className="st-figure font-medium">{next}</span>
            </>
          )}
        </p>
        <CustomSelect<AdjustReason> label="Reason" options={REASON_OPTIONS} value={reason} onChange={(v) => setReason(v as AdjustReason)} />
        <CustomTextarea label="Note (optional)" rows={2} maxLength={500} value={note} dir="auto" onChange={(event) => setNote(event.target.value)} />
      </div>
    </DialogBody>
  );
}

/**
 * Bulk adjustment for the selected rows of the loaded page: one change per row,
 * one shared reason and note. Rows left blank are skipped. The server applies
 * the batch (max 100 items) and is authoritative.
 */
export function BulkAdjustDialog({ items, titleId, descriptionId, resolve, dismiss }: DialogContentProps<boolean> & { items: InventoryItem[] }) {
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<AdjustReason>("ADJUSTMENT");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    const entries = items.map((item) => ({ item, text: (deltas[item._id] ?? "").trim() })).filter((e) => e.text !== "");
    if (entries.length === 0) {
      setError("Enter a change for at least one row.");
      return;
    }
    const bad = entries.find((e) => parseDelta(e.text) === null);
    if (bad) {
      setError(`${bad.item.sku}: ${DELTA_ERROR}`);
      return;
    }
    setBusy(true);
    const ok = await runAction(
      () =>
        requester(bulkAdjustStockEndpoint, {
          body: { items: entries.map((e) => ({ variantId: e.item._id, delta: parseDelta(e.text) as number, reason, note: note.trim() || undefined })) },
        }),
      `${entries.length} ${entries.length === 1 ? "variant" : "variants"} adjusted`,
    );
    if (ok) resolve(true);
    else setBusy(false);
  }

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title={`Adjust stock for ${items.length} ${items.length === 1 ? "variant" : "variants"}`}
      description="Positive adds, negative removes. Leave a row blank to skip it."
      actions={
        <>
          <CustomButton variant="outline" onClick={dismiss} disabled={busy}>
            Cancel
          </CustomButton>
          <CustomButton onClick={submit} loading={busy}>
            Apply adjustments
          </CustomButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex max-h-72 flex-col gap-3 overflow-y-auto">
          {items.map((item) => {
            const next = previewStock(item.stock, parseDelta(deltas[item._id] ?? ""));
            return (
              <li key={item._id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span dir="auto" className="block truncate font-medium">
                    {variantLabel(item)}
                  </span>
                  <span className="st-figure text-[var(--st-ink-muted)]">
                    {item.sku} · {item.stock}
                    {next === null ? "" : ` → ${next}`}
                  </span>
                </div>
                <input
                  aria-label={`Change for ${item.sku}`}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="±"
                  className="st-figure h-11 w-24 shrink-0 rounded-md border border-[var(--st-line-strong)] bg-[var(--st-surface)] px-3 text-right"
                  value={deltas[item._id] ?? ""}
                  onChange={(event) => {
                    setDeltas((d) => ({ ...d, [item._id]: event.target.value }));
                    if (error) setError(undefined);
                  }}
                />
              </li>
            );
          })}
        </ul>
        {error ? (
          <p role="alert" className="text-[var(--st-status-danger)]">
            {error}
          </p>
        ) : null}
        <CustomSelect<AdjustReason> label="Reason" options={REASON_OPTIONS} value={reason} onChange={(v) => setReason(v as AdjustReason)} />
        <CustomTextarea label="Note (optional)" rows={2} maxLength={500} value={note} dir="auto" onChange={(event) => setNote(event.target.value)} />
      </div>
    </DialogBody>
  );
}
