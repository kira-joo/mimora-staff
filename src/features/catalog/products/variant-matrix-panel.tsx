"use client";

import { isApiError, requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton, showApiErrorToast, toast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { Product } from "src/api/products.endpoints";
import { bulkCreateVariantsEndpoint, bulkUpdateVariantsEndpoint } from "src/api/variant-matrix.endpoints";
import { listVariantsEndpoint, type Variant } from "src/api/variants.endpoints";
import { AppPermission } from "src/common/authorization/authorization-registry";
import { AppRoute } from "src/common/routes/app-route";
import { usePermission } from "src/features/auth/use-permission";
import {
  MAX_BULK_ROWS,
  blankCreateDraft,
  changesFor,
  coverage,
  createProblems,
  defaultSkuPattern,
  draftFromVariant,
  existingProblems,
  fillSelected,
  generateCombinations,
  indexByCombination,
  matrixAxes,
  problemsByRow,
  suggestSku,
  toCreateRow,
  type Combination,
  type CreateDraft,
  type ExistingDraft,
  type FieldProblems,
} from "./variant-matrix-grid";

type Filter = "all" | "missing" | "existing";

const cell = "px-2 py-1 align-middle";
const input =
  "st-figure h-8 w-full min-w-[5.5rem] rounded border border-[var(--st-line)] bg-[var(--st-surface)] px-2 text-end text-[13px] outline-offset-2 focus-visible:outline focus-visible:outline-2 disabled:bg-[var(--st-canvas)] disabled:text-[var(--st-ink-muted)] aria-[invalid=true]:border-[var(--st-status-danger)]";

/**
 * The variant matrix: every combination of the product's options as one row, marking which exist. Staff create the
 * missing combinations they choose in bulk (SKU pattern, price, compare-at, cost, opening stock) and edit price, compare-at,
 * cost and on/off sale of existing variants in place. The matrix may be sparse — nothing makes every combination exist.
 *
 * Each of the two saves is one transaction on the server: every row, or none. Stock is not edited here — it changes
 * through Inventory, which keeps the record of each movement.
 *
 * Keyboard: every cell is a native control, so Tab walks the row; ArrowUp/ArrowDown move to the same column in the
 * next/previous row. Each control is labelled with its combination ("Price for Red · M").
 */
export function VariantMatrixPanel({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const can = usePermission();
  const canUpdate = can(AppPermission.VARIANT.UPDATE);
  const canCreate = can(AppPermission.VARIANT.CREATE);
  const headingId = useId();
  const query = useRequesterQuery({ endpoint: listVariantsEndpoint, options: { query: { productId: product._id, limit: 100 } } });
  const variants = useMemo(() => query.data?.data ?? [], [query.data]);

  const axes = useMemo(() => matrixAxes(product.optionAxes, variants), [product.optionAxes, variants]);
  const combinations = useMemo(() => generateCombinations(axes), [axes]);
  const existing = useMemo(() => indexByCombination(variants), [variants]);
  const summary = coverage(combinations, existing);

  const [filter, setFilter] = useState<Filter>("all");
  const [edits, setEdits] = useState<Record<string, Partial<ExistingDraft>>>({});
  const [creates, setCreates] = useState<Record<string, CreateDraft>>({});
  const [pattern, setPattern] = useState(() => defaultSkuPattern(product.slug, product.optionAxes));
  const [fill, setFill] = useState({ price: "", compareAtPrice: "", costPrice: "", stock: "" });
  const [server, setServer] = useState<Map<string, Partial<Record<string, string>>>>(new Map());
  const [busy, setBusy] = useState<"update" | "create" | null>(null);

  const draftOf = (variant: Variant): ExistingDraft => ({ ...draftFromVariant(variant), ...edits[variant._id] });
  const createOf = (id: string): CreateDraft => creates[id] ?? blankCreateDraft();
  const setEdit = (variant: Variant, patch: Partial<ExistingDraft>) => setEdits((current) => ({ ...current, [variant._id]: { ...current[variant._id], ...patch } }));
  const setCreate = (id: string, patch: Partial<CreateDraft>) => setCreates((current) => ({ ...current, [id]: { ...(current[id] ?? blankCreateDraft()), ...patch } }));

  const missing = combinations.filter((combination) => !existing.has(combination.id));
  const selected = missing.filter((combination) => createOf(combination.id).selected);
  const rowsShown = combinations.filter((combination) => (filter === "all" ? true : filter === "missing" ? !existing.has(combination.id) : existing.has(combination.id)));

  const changed = variants.flatMap((variant) => {
    const row = changesFor(variant, draftOf(variant));
    return row ? [{ variant, row }] : [];
  });
  const updateProblems = new Map(changed.map(({ variant }) => [variant._id, existingProblems(draftOf(variant))]));
  const createRowProblems = new Map(selected.map((combination) => [combination.id, createProblems(createOf(combination.id))]));
  const hasProblems = (map: Map<string, FieldProblems>) => [...map.values()].some((problems) => Object.keys(problems).length > 0);

  function selectMissing(on: boolean) {
    const limit = on ? missing.slice(0, MAX_BULK_ROWS) : missing;
    setCreates((current) => {
      const next = { ...current };
      for (const combination of limit) next[combination.id] = { ...(current[combination.id] ?? blankCreateDraft()), selected: on };
      return next;
    });
  }

  function suggestSkus() {
    const taken = new Set([...variants.map((variant) => variant.sku), ...Object.values(creates).filter((draft) => draft.selected && draft.sku.trim()).map((draft) => draft.sku.trim())]);
    setCreates((current) => {
      const next = { ...current };
      for (const combination of selected) {
        const draft = current[combination.id] ?? blankCreateDraft();
        // A SKU the person already typed is theirs; only blanks are filled.
        if (draft.sku.trim()) continue;
        const sku = suggestSku(pattern, combination, axes, taken);
        taken.add(sku);
        next[combination.id] = { ...draft, sku };
      }
      return next;
    });
  }

  async function saveEdits() {
    setBusy("update");
    setServer(new Map());
    try {
      await requester(bulkUpdateVariantsEndpoint, { body: { productId: product._id, rows: changed.map(({ row }) => row) } });
      toast.success(`${changed.length} ${changed.length === 1 ? "variant" : "variants"} updated`);
      setEdits({});
      await query.refetch();
      onChanged();
    } catch (error) {
      reportRefusal(error, changed.map(({ variant }) => variant._id));
    } finally {
      setBusy(null);
    }
  }

  async function createSelected() {
    setBusy("create");
    setServer(new Map());
    try {
      await requester(bulkCreateVariantsEndpoint, { body: { productId: product._id, rows: selected.map((combination) => toCreateRow(combination, createOf(combination.id))) } });
      toast.success(`${selected.length} ${selected.length === 1 ? "variant" : "variants"} created`);
      setCreates((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !selected.some((combination) => combination.id === id))));
      await query.refetch();
      onChanged();
    } catch (error) {
      reportRefusal(error, selected.map((combination) => combination.id));
    } finally {
      setBusy(null);
    }
  }

  function reportRefusal(error: unknown, rowIds: string[]) {
    if (isApiError(error) && error.validationErrors?.length) {
      setServer(problemsByRow(error.validationErrors, rowIds));
      toast.error("Nothing was saved — fix the marked rows and try again.");
    } else {
      showApiErrorToast(isApiError(error) ? error : { message: "Something went wrong. Try again." });
    }
  }

  if (product.optionAxes.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="rounded-md border border-[var(--st-line)] bg-[var(--st-surface)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--st-line)] px-4 py-3">
        <div className="flex flex-col">
          <h2 id={headingId} className="text-[13px] font-semibold uppercase tracking-wide text-[var(--st-ink-muted)]">
            Variant matrix
          </h2>
          <p className="text-[13px] text-[var(--st-ink-muted)]" role="status">
            {query.isLoading ? "Loading…" : combinations.length === 0 ? "No combinations yet." : `${summary.total} combinations · ${summary.existing} exist · ${summary.missing} missing`}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px]">
          Show
          <select className="h-8 rounded border border-[var(--st-line)] bg-[var(--st-surface)] px-2" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
            <option value="all">All combinations</option>
            <option value="missing">Missing only</option>
            <option value="existing">Existing only</option>
          </select>
        </label>
      </header>

      {combinations.length === 0 && !query.isLoading ? (
        <p className="px-4 py-6 text-[var(--st-ink-muted)]">
          The matrix lays out every combination of the product&apos;s option values. List the values each option offers in <strong>Options</strong> below (for example Red and Blue under Colour), save, and the
          combinations appear here.
        </p>
      ) : (
        <>
          {canCreate && missing.length > 0 ? (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-[var(--st-line)] bg-[var(--st-canvas)] px-4 py-3 text-[13px]">
              <div className="flex gap-2">
                <CustomButton type="button" variant="outline" onClick={() => selectMissing(true)}>
                  Select missing ({Math.min(missing.length, MAX_BULK_ROWS)})
                </CustomButton>
                <CustomButton type="button" variant="ghost" disabled={selected.length === 0} onClick={() => selectMissing(false)}>
                  Clear
                </CustomButton>
              </div>
              <label className="flex flex-col gap-1">
                SKU pattern
                <input className={`${input} w-56 text-start`} dir="ltr" value={pattern} onChange={(event) => setPattern(event.target.value)} aria-describedby={`${headingId}-pattern`} />
              </label>
              <CustomButton type="button" variant="outline" disabled={selected.length === 0} onClick={suggestSkus}>
                Suggest SKUs
              </CustomButton>
              {(["price", "compareAtPrice", "costPrice", "stock"] as const).map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  {{ price: "Price", compareAtPrice: "Compare-at", costPrice: "Cost", stock: "Opening stock" }[field]}
                  <input className={`${input} w-24`} dir="ltr" inputMode="decimal" value={fill[field]} onChange={(event) => setFill({ ...fill, [field]: event.target.value })} />
                </label>
              ))}
              <CustomButton type="button" variant="outline" disabled={selected.length === 0} onClick={() => setCreates(fillSelected(creates, fill))}>
                Apply to selected
              </CustomButton>
              <p id={`${headingId}-pattern`} className="basis-full text-[12px] text-[var(--st-ink-muted)]">
                In the pattern, {"{"}option{"}"} is replaced by that option&apos;s value, e.g. {"{"}{product.optionAxes[0]?.key}{"}"}. A SKU you typed yourself is never overwritten. Blank fill fields change nothing.
              </p>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] border-collapse text-start text-[13px]">
              <caption className="sr-only">Every combination of {product.optionAxes.map((axis) => axis.name.en || axis.key).join(" and ")}, with its SKU, price, compare-at price, cost, stock and whether it is on sale.</caption>
              <thead>
                <tr className="text-[12px] uppercase tracking-wide text-[var(--st-ink-muted)]">
                  <th scope="col" className={`${cell} text-start font-semibold`}>
                    State
                  </th>
                  {axes.map((axis) => (
                    <th key={axis.key} scope="col" className={`${cell} text-start font-semibold`}>
                      {axis.label}
                    </th>
                  ))}
                  <th scope="col" className={`${cell} text-start font-semibold`}>SKU</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>Price</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>Compare-at</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>Cost</th>
                  <th scope="col" className={`${cell} text-end font-semibold`}>Stock</th>
                  <th scope="col" className={`${cell} text-center font-semibold`}>On sale</th>
                </tr>
              </thead>
              <tbody>
                {rowsShown.map((combination) => {
                  const variant = existing.get(combination.id);
                  return variant ? (
                    <ExistingRow key={combination.id} combination={combination} variant={variant} draft={draftOf(variant)} edited={Boolean(changesFor(variant, draftOf(variant)))} canUpdate={canUpdate} problems={{ ...updateProblems.get(variant._id), ...server.get(variant._id) }} onChange={(patch) => setEdit(variant, patch)} />
                  ) : (
                    <MissingRow key={combination.id} combination={combination} draft={createOf(combination.id)} canCreate={canCreate} problems={createRowProblems.get(combination.id) ?? {}} onChange={(patch) => setCreate(combination.id, patch)} serverProblems={server.get(combination.id)} />
                  );
                })}
              </tbody>
            </table>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--st-line)] px-4 py-3">
            <p className="text-[13px] text-[var(--st-ink-muted)]">
              Stock is not edited here. Change it with an adjustment in <Link href={AppRoute.INVENTORY} className="font-medium text-[var(--st-ink)] underline">Inventory</Link>, which keeps a record of every movement.
            </p>
            <div className="flex flex-wrap gap-2">
              {canUpdate ? (
                <>
                  <CustomButton type="button" variant="ghost" disabled={changed.length === 0 || busy !== null} onClick={() => setEdits({})}>
                    Discard edits
                  </CustomButton>
                  <CustomButton type="button" variant="outline" disabled={changed.length === 0 || hasProblems(updateProblems) || busy !== null} onClick={() => void saveEdits()}>
                    {busy === "update" ? "Saving…" : `Save changes (${changed.length})`}
                  </CustomButton>
                </>
              ) : null}
              {canCreate ? (
                <CustomButton type="button" disabled={selected.length === 0 || hasProblems(createRowProblems) || busy !== null} onClick={() => void createSelected()}>
                  {busy === "create" ? "Creating…" : `Create ${selected.length} ${selected.length === 1 ? "variant" : "variants"}`}
                </CustomButton>
              ) : null}
            </div>
          </footer>
        </>
      )}
    </section>
  );
}

/** A money cell: text in, text out (money is never parsed into a number here). Top-level, so a keystroke does not remount it and drop focus. */
function MoneyInput({ column, label, value, onChange, problem, disabled }: { column: string; label: string; value: string; onChange: (value: string) => void; problem?: string; disabled?: boolean }) {
  const problemId = useId();
  return (
    <>
      <input
        className={input}
        dir="ltr"
        inputMode="decimal"
        data-col={column}
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => moveFocusFrom(event, column)}
      />
      {problem ? (
        <span id={problemId} role="alert" className="block text-start text-[12px] font-medium text-[var(--st-status-danger)]">
          {problem}
        </span>
      ) : null}
    </>
  );
}

function StateCell({ exists }: { exists: boolean }) {
  return exists ? (
    <span className="inline-flex items-center gap-1 font-medium text-[var(--st-status-done)]">
      <Check aria-hidden="true" className="size-3.5" />
      Exists
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[var(--st-ink-muted)]">
      <Minus aria-hidden="true" className="size-3.5" />
      Missing
    </span>
  );
}

function ExistingRow({ combination, variant, draft, edited, canUpdate, problems, onChange }: { combination: Combination; variant: Variant; draft: ExistingDraft; edited: boolean; canUpdate: boolean; problems: FieldProblems; onChange: (patch: Partial<ExistingDraft>) => void }) {
  return (
    <tr className={`border-t border-[var(--st-line)] ${edited ? "bg-[var(--st-canvas)]" : ""}`}>
      <td className={`${cell} whitespace-nowrap`}>
        <StateCell exists />
        {edited ? <span className="ms-2 text-[12px] text-[var(--st-ink-muted)]">edited</span> : null}
      </td>
      {combination.optionValues.map((option, position) => (
        <td key={option.key} dir="auto" className={cell}>
          {combination.label.split(" · ")[position] ?? option.value}
        </td>
      ))}
      <td className={`${cell} st-figure whitespace-nowrap`}>{variant.sku}</td>
      <td className={`${cell} text-end`}>
        <MoneyInput column="price" label={`Price for ${combination.label}`} value={draft.price} onChange={(price) => onChange({ price })} problem={problems.price} disabled={!canUpdate} />
      </td>
      <td className={`${cell} text-end`}>
        <MoneyInput column="compare" label={`Compare-at price for ${combination.label}`} value={draft.compareAtPrice} onChange={(compareAtPrice) => onChange({ compareAtPrice })} problem={problems.compareAtPrice} disabled={!canUpdate} />
      </td>
      <td className={`${cell} text-end`}>
        <MoneyInput column="cost" label={`Cost for ${combination.label}`} value={draft.costPrice} onChange={(costPrice) => onChange({ costPrice })} problem={problems.costPrice} disabled={!canUpdate} />
      </td>
      <td className={`${cell} st-figure text-end`}>{variant.stock}</td>
      <td className={`${cell} text-center`}>
        <input type="checkbox" className="size-4" aria-label={`${combination.label} is on sale`} checked={draft.active} disabled={!canUpdate} onChange={(event) => onChange({ active: event.target.checked })} />
      </td>
    </tr>
  );
}

function MissingRow({ combination, draft, canCreate, problems, serverProblems, onChange }: { combination: Combination; draft: CreateDraft; canCreate: boolean; problems: FieldProblems; serverProblems?: Partial<Record<string, string>>; onChange: (patch: Partial<CreateDraft>) => void }) {
  const off = !draft.selected || !canCreate;
  // Only a selected row's problems show: an unselected row asks nothing of the person.
  const shown = (field: string) => (draft.selected ? (problems as Partial<Record<string, string>>)[field] ?? serverProblems?.[field] : undefined);
  return (
    <tr className="border-t border-[var(--st-line)] text-[var(--st-ink-muted)]">
      <td className={`${cell} whitespace-nowrap`}>
        {canCreate ? (
          <label className="flex items-center gap-2 text-[var(--st-ink)]">
            <input type="checkbox" className="size-4" checked={draft.selected} onChange={(event) => onChange({ selected: event.target.checked })} aria-label={`Create ${combination.label}`} />
            Missing
          </label>
        ) : (
          <StateCell exists={false} />
        )}
      </td>
      {combination.optionValues.map((option, position) => (
        <td key={option.key} dir="auto" className={`${cell} text-[var(--st-ink)]`}>
          {combination.label.split(" · ")[position] ?? option.value}
        </td>
      ))}
      <td className={cell}>
        <input className={`${input} text-start`} dir="ltr" data-col="sku" aria-label={`SKU for ${combination.label}`} aria-invalid={shown("sku") ? true : undefined} value={draft.sku} disabled={off} onChange={(event) => onChange({ sku: event.target.value })} onKeyDown={(event) => moveFocusFrom(event, "sku")} />
        {shown("sku") ? (
          <span role="alert" className="block text-[12px] font-medium text-[var(--st-status-danger)]">
            {shown("sku")}
          </span>
        ) : null}
        {shown("optionValues") ? (
          <span role="alert" className="block text-[12px] font-medium text-[var(--st-status-danger)]">
            {shown("optionValues")}
          </span>
        ) : null}
      </td>
      <td className={`${cell} text-end`}>
        <MoneyInput column="price" label={`Price for ${combination.label}`} value={draft.price} onChange={(price) => onChange({ price })} problem={shown("price")} disabled={off} />
      </td>
      <td className={`${cell} text-end`}>
        <MoneyInput column="compare" label={`Compare-at price for ${combination.label}`} value={draft.compareAtPrice} onChange={(compareAtPrice) => onChange({ compareAtPrice })} problem={shown("compareAtPrice")} disabled={off} />
      </td>
      <td className={`${cell} text-end`}>
        <MoneyInput column="cost" label={`Cost for ${combination.label}`} value={draft.costPrice} onChange={(costPrice) => onChange({ costPrice })} problem={shown("costPrice")} disabled={off} />
      </td>
      <td className={`${cell} text-end`}>
        <input className={input} dir="ltr" inputMode="numeric" data-col="stock" aria-label={`Opening stock for ${combination.label}`} aria-invalid={shown("stock") ? true : undefined} value={draft.stock} disabled={off} onChange={(event) => onChange({ stock: event.target.value })} onKeyDown={(event) => moveFocusFrom(event, "stock")} />
        {shown("stock") ? (
          <span role="alert" className="block text-start text-[12px] font-medium text-[var(--st-status-danger)]">
            {shown("stock")}
          </span>
        ) : null}
      </td>
      <td className={`${cell} text-center`}>
        <span className="sr-only">Not created yet</span>
      </td>
    </tr>
  );
}

/** ArrowUp/ArrowDown/Enter to the same column of the next enabled row. Shared by the plain inputs; money inputs call the same logic. */
function moveFocusFrom(event: KeyboardEvent<HTMLInputElement>, column: string) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
  const cells = [...(event.currentTarget.closest("table")?.querySelectorAll<HTMLInputElement>(`[data-col="${column}"]:not(:disabled)`) ?? [])];
  const at = cells.indexOf(event.currentTarget);
  const target = cells[at + (event.key === "ArrowUp" ? -1 : 1)];
  if (target) {
    event.preventDefault();
    target.focus();
    target.select?.();
  }
}
