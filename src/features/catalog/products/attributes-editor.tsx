"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { CustomButton } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { CustomInput } from "@kira-joo/frontend-toolkit-tailwind/inputs";
import { DialogBody, modalPresentation, useDialog, type DialogContentProps } from "@kira-joo/frontend-toolkit-tailwind/dialog";
import { Check, Plus, Search, Trash2, X } from "lucide-react";
import type { ProductAttribute } from "src/api/products.endpoints";
import { listProductAttributesEndpoint, type AttributeCatalogEntry } from "src/api/product-attributes.endpoints";
import type { LocalizedText } from "src/api/brands.endpoints";
import { findSimilar, findSimilarValues, searchAttributes } from "src/server/catalog/attribute-similarity";
import { displayName } from "../catalog-display";
import { suggestKey } from "./product-options";

type AttributeValue = ProductAttribute["values"][number];

const KEY_MAX = 50;
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const KEY_HELP = "Use lowercase letters, digits and dashes, up to 50 characters.";
const TAP = "min-h-[var(--st-tap-min)]";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--st-focus)]";
const PANEL = "flex flex-col gap-3 border border-[var(--st-line-strong)] bg-[var(--st-surface)] p-3";

/** An Enter inside the product form's inputs would otherwise save the whole product. */
const swallowEnter = (event: KeyboardEvent<HTMLInputElement>, then?: () => void) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  then?.();
};

const blankName = (name: LocalizedText) => !name.en.trim() && !name.ar.trim();

/** The name as staff read it: English, then Arabic (right-to-left), `dir="auto"` on each so mixed text lays out correctly. */
function NameText({ name, fallback }: { name: LocalizedText; fallback?: string }) {
  return (
    <>
      {name.en.trim() ? <span dir="auto">{name.en}</span> : null}
      {name.ar.trim() ? (
        <span dir="rtl" lang="ar" className="text-[var(--st-ink-muted)]">
          {name.ar}
        </span>
      ) : null}
      {blankName(name) ? <span>{fallback}</span> : null}
    </>
  );
}

/** Catalog entries plus attributes this product carries that no saved product has yet, so an unsaved attribute is also something to "use", not to retype. */
function buildPool(catalog: readonly AttributeCatalogEntry[], attributes: readonly ProductAttribute[]): AttributeCatalogEntry[] {
  const known = new Set(catalog.map((entry) => entry.key));
  const local = attributes
    .filter((attribute) => attribute.key && !known.has(attribute.key))
    .map((attribute): AttributeCatalogEntry => ({
      key: attribute.key,
      name: attribute.name,
      nameVariants: [attribute.name],
      productCount: 0,
      values: attribute.values.map((value) => ({ key: value.key, value: value.value, productCount: 0 })),
    }));
  return [...catalog, ...local];
}

interface Chip {
  key: string;
  label: LocalizedText;
  selected: boolean;
}

/** Every value known for an attribute — the catalog's, then any this product has that the catalog lacks. A selected chip shows the product's own stored label. */
function chipsFor(attribute: ProductAttribute, entry: AttributeCatalogEntry | undefined): Chip[] {
  const own = new Map(attribute.values.map((value) => [value.key, value.value]));
  const chips: Chip[] = (entry?.values ?? []).map((value) => ({ key: value.key, label: own.get(value.key) ?? value.value, selected: own.has(value.key) }));
  const listed = new Set(chips.map((chip) => chip.key));
  for (const value of attribute.values) if (!listed.has(value.key)) chips.push({ key: value.key, label: value.value, selected: true });
  return chips;
}


/* ------------------------------------------------------------------ new attribute (dialog) */

type NewAttributeResult = { kind: "select"; key: string } | { kind: "create"; key: string; name: LocalizedText };

interface NewAttributeDialogProps {
  pool: AttributeCatalogEntry[];
  initialName: string;
}

/**
 * The deliberate, secondary path: a new attribute. An exact match is refused with a way to use the existing one; a near
 * match lists what it resembles and needs an explicit "Create anyway". The server independently refuses an exact duplicate.
 */
function NewAttributeDialog({ pool, initialName, titleId, descriptionId, resolve, dismiss }: NewAttributeDialogProps & DialogContentProps<NewAttributeResult>) {
  const startsArabic = /[؀-ۿ]/.test(initialName);
  const [en, setEn] = useState(startsArabic ? "" : initialName.trim());
  const [ar, setAr] = useState(startsArabic ? initialName.trim() : "");
  const [typedKey, setTypedKey] = useState<string | null>(null);
  const key = (typedKey ?? suggestKey(en)).trim();

  const similar = useMemo(() => findSimilar({ key, en, ar }, pool), [key, en, ar, pool]);
  const named = Boolean(en.trim() || ar.trim());
  const keyProblem = !key ? "A key is required." : key.length > KEY_MAX || !KEY_PATTERN.test(key) ? KEY_HELP : undefined;
  const blocked = similar.exact.length > 0;
  const nearOnly = !blocked && similar.near.length > 0;

  const matchRow = (entry: AttributeCatalogEntry) => (
    <li key={entry.key} className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <NameText name={entry.name} fallback={entry.key} />
        <span className="st-figure text-[13px] text-[var(--st-ink-muted)]">{entry.key}</span>
      </span>
      <CustomButton type="button" variant="outline" className={TAP} onClick={() => resolve({ kind: "select", key: entry.key })}>
        Use this
      </CustomButton>
    </li>
  );

  return (
    <DialogBody
      titleId={titleId}
      descriptionId={descriptionId}
      title="Create a new attribute"
      description="Only if no existing attribute fits. A second spelling of an attribute splits the storefront filter in two."
      actions={
        <>
          <CustomButton type="button" variant="ghost" className={TAP} onClick={dismiss}>
            Cancel
          </CustomButton>
          <CustomButton
            type="button"
            className={TAP}
            disabled={!named || Boolean(keyProblem) || blocked}
            onClick={() => resolve({ kind: "create", key, name: { en: en.trim(), ar: ar.trim() } })}
          >
            {nearOnly ? "Create anyway" : "Create attribute"}
          </CustomButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <CustomInput label="Name (English)" dir="auto" value={en} onChange={(event) => setEn(event.target.value)} onKeyDown={swallowEnter} autoFocus />
          <CustomInput label="Name (Arabic)" dir="rtl" lang="ar" value={ar} onChange={(event) => setAr(event.target.value)} onKeyDown={swallowEnter} />
        </div>
        <CustomInput
          label="Key"
          className="st-figure"
          description="The code the storefront filters by. Made from the English name; it can't change once products use it."
          value={typedKey ?? suggestKey(en)}
          maxLength={KEY_MAX}
          error={typedKey !== null || key ? keyProblem : undefined}
          onChange={(event) => setTypedKey(event.target.value)}
          onKeyDown={swallowEnter}
        />
        {blocked ? (
          <div role="alert" className="flex flex-col gap-2 border border-[var(--st-status-danger)] p-3">
            <p className="font-medium text-[var(--st-status-danger)]">This attribute already exists. Select it instead of creating it again.</p>
            <ul className="flex flex-col gap-2">{similar.exact.map(matchRow)}</ul>
          </div>
        ) : null}
        {nearOnly ? (
          <div role="status" className="flex flex-col gap-2 border border-[var(--st-line-strong)] p-3">
            <p className="font-medium">Similar attributes already exist. Is one of these what you mean?</p>
            <ul className="flex flex-col gap-2">{similar.near.map(matchRow)}</ul>
          </div>
        ) : null}
      </div>
    </DialogBody>
  );
}

/* ------------------------------------------------------------------ new value (inline) */

function NewValueComposer({ attributeName, known, onUse, onAdd, onCancel }: { attributeName: string; known: Chip[]; onUse: (chip: Chip) => void; onAdd: (value: AttributeValue) => void; onCancel: () => void }) {
  const [en, setEn] = useState("");
  const [ar, setAr] = useState("");
  const [typedKey, setTypedKey] = useState<string | null>(null);
  const key = (typedKey ?? suggestKey(en)).trim();

  const similar = useMemo(() => findSimilarValues({ key, en, ar }, known.map((chip) => ({ key: chip.key, value: chip.label, chip }))), [key, en, ar, known]);
  const named = Boolean(en.trim() || ar.trim());
  const keyProblem = !key ? "A key is required." : key.length > KEY_MAX || !KEY_PATTERN.test(key) ? KEY_HELP : undefined;
  const blocked = similar.exact.length > 0;
  const nearOnly = !blocked && similar.near.length > 0;

  const row = (match: (typeof similar.exact)[number]) => (
    <li key={match.key} className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <NameText name={match.value} fallback={match.key} />
        <span className="st-figure text-[13px] text-[var(--st-ink-muted)]">{match.key}</span>
      </span>
      <CustomButton type="button" variant="outline" className={TAP} onClick={() => onUse(match.chip)}>
        {match.chip.selected ? "Already selected" : "Use this"}
      </CustomButton>
    </li>
  );

  return (
    <div className={PANEL} role="group" aria-label={`New value for ${attributeName}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <CustomInput label="Value (English)" dir="auto" value={en} onChange={(event) => setEn(event.target.value)} onKeyDown={swallowEnter} />
        <CustomInput label="Value (Arabic)" dir="rtl" lang="ar" value={ar} onChange={(event) => setAr(event.target.value)} onKeyDown={swallowEnter} />
      </div>
      <CustomInput
        label="Key"
        className="st-figure"
        value={typedKey ?? suggestKey(en)}
        maxLength={KEY_MAX}
        error={typedKey !== null || key ? keyProblem : undefined}
        onChange={(event) => setTypedKey(event.target.value)}
        onKeyDown={swallowEnter}
      />
      {blocked ? (
        <div role="alert" className="flex flex-col gap-2 border border-[var(--st-status-danger)] p-3">
          <p className="font-medium text-[var(--st-status-danger)]">This value already exists for {attributeName}. Use the existing one.</p>
          <ul className="flex flex-col gap-2">{similar.exact.map(row)}</ul>
        </div>
      ) : null}
      {nearOnly ? (
        <div role="status" className="flex flex-col gap-2 border border-[var(--st-line-strong)] p-3">
          <p className="font-medium">Similar values already exist. Is one of these what you mean?</p>
          <ul className="flex flex-col gap-2">{similar.near.map(row)}</ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <CustomButton type="button" className={TAP} disabled={!named || Boolean(keyProblem) || blocked} onClick={() => onAdd({ key, value: { en: en.trim(), ar: ar.trim() } })}>
          {nearOnly ? "Add anyway" : "Add value"}
        </CustomButton>
        <CustomButton type="button" variant="ghost" className={TAP} onClick={onCancel}>
          Cancel
        </CustomButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

/**
 * Browsing facets (material, fit), each with its values. Attributes are PICKED from the ones products already use — a new
 * one is a deliberate, duplicate-checked second step — because the storefront filters by key and every spelling of an
 * attribute becomes its own filter. Not used to build variants.
 *
 * An attribute already saved on this product keeps its stored name, key and values exactly; it can be removed, and
 * catalog values can be added to it.
 */
export function AttributesEditor({ value, onChange, error, disabled }: { value: ProductAttribute[]; onChange: (attributes: ProductAttribute[]) => void; error?: string; disabled?: boolean }) {
  const { openDialog } = useDialog();
  const query = useRequesterQuery({ endpoint: listProductAttributesEndpoint, queryOptions: { staleTime: 30_000 } });
  const catalog = useMemo(() => query.data?.data ?? [], [query.data]);
  const pool = useMemo(() => buildPool(catalog, value), [catalog, value]);
  const byKey = useMemo(() => new Map(pool.map((entry) => [entry.key, entry])), [pool]);
  const catalogReady = query.isSuccess;

  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const onProduct = new Set(value.map((attribute) => attribute.key));
  const update = (index: number, next: ProductAttribute) => onChange(value.map((attribute, i) => (i === index ? next : attribute)));

  function openPicker() {
    setNotice("");
    setPicking(true);
    void query.refetch();
  }
  function closePicker() {
    setPicking(false);
    setSearch("");
  }
  function addExisting(entry: AttributeCatalogEntry) {
    if (onProduct.has(entry.key)) {
      setNotice(`${displayName(entry.name) || entry.key} is already on this product.`);
      return;
    }
    onChange([...value, { key: entry.key, name: entry.name, values: [] }]);
    closePicker();
  }
  async function createNew() {
    const outcome = await openDialog<typeof NewAttributeDialog, NewAttributeResult>({
      component: NewAttributeDialog,
      props: { pool, initialName: search },
      presentation: modalPresentation({ size: "lg" }),
    }).result;
    if (outcome.status !== "resolved") return;
    const result = outcome.value;
    if (result.kind === "select") {
      const entry = byKey.get(result.key);
      if (entry) addExisting(entry);
      return;
    }
    onChange([...value, { key: result.key, name: result.name, values: [] }]);
    setComposing(result.key);
    closePicker();
  }

  // Direct hits first, then other spellings of attributes that already exist ("colour" → Color, "الألوان" → اللون).
  const results = searchAttributes(pool, search);

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 ? <p className="text-[var(--st-ink-muted)]">No attributes.</p> : null}
      <ul className="flex flex-col gap-3">
        {value.map((attribute, index) => {
          const name = displayName(attribute.name) || attribute.key || `attribute ${index + 1}`;
          const entry = byKey.get(attribute.key);
          const chips = chipsFor(attribute, entry);
          const toggle = (chip: Chip) => {
            if (chip.selected) update(index, { ...attribute, values: attribute.values.filter((v) => v.key !== chip.key) });
            else update(index, { ...attribute, values: [...attribute.values, { key: chip.key, value: chip.label }] });
          };
          return (
            <li key={attribute.key || index} className="flex flex-col gap-3 border border-[var(--st-line)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-medium">
                    <NameText name={attribute.name} fallback={attribute.key} />
                  </p>
                  <p className="text-[13px] text-[var(--st-ink-muted)]">
                    <span className="st-figure">{attribute.key}</span>
                    {entry && entry.productCount > 0 ? ` · used by ${entry.productCount} ${entry.productCount === 1 ? "product" : "products"}` : " · new"}
                  </p>
                </div>
                <CustomButton
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="min-h-[var(--st-tap-min)] min-w-[var(--st-tap-min)] shrink-0"
                  aria-label={`Remove ${name}`}
                  disabled={disabled}
                  onClick={() => {
                    onChange(value.filter((_, i) => i !== index));
                    if (composing === attribute.key) setComposing(null);
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </CustomButton>
              </div>
              <fieldset className="flex flex-col gap-2 border-s-2 border-[var(--st-line)] ps-3">
                <legend className="mb-1 text-[13px] font-medium text-[var(--st-ink-muted)]">
                  Values of <span dir="auto">{name}</span>
                </legend>
                {chips.length === 0 ? <p className="text-[var(--st-ink-muted)]">No values yet. Add one below.</p> : null}
                {chips.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {chips.map((chip) => (
                      <button
                        key={chip.key}
                        type="button"
                        aria-pressed={chip.selected}
                        disabled={disabled}
                        onClick={() => toggle(chip)}
                        className={`inline-flex ${TAP} items-center gap-2 border border-[var(--st-line-strong)] px-4 text-[14px] font-medium hover:bg-[var(--st-accent-soft)] aria-pressed:border-[var(--st-ink)] aria-pressed:bg-[var(--st-accent-soft)] disabled:opacity-60 ${FOCUS}`}
                      >
                        {chip.selected ? <Check className="size-4" aria-hidden="true" /> : null}
                        <NameText name={chip.label} fallback={chip.key} />
                      </button>
                    ))}
                  </div>
                ) : null}
                {composing === attribute.key ? (
                  <NewValueComposer
                    attributeName={name}
                    known={chips}
                    onCancel={() => setComposing(null)}
                    onUse={(chip) => {
                      if (!chip.selected) toggle(chip);
                      setComposing(null);
                    }}
                    onAdd={(next) => {
                      update(index, { ...attribute, values: [...attribute.values, next] });
                      setComposing(null);
                    }}
                  />
                ) : (
                  <div>
                    <CustomButton type="button" variant="ghost" leftIcon={Plus} className={TAP} disabled={disabled} onClick={() => setComposing(attribute.key)}>
                      New value
                    </CustomButton>
                  </div>
                )}
              </fieldset>
            </li>
          );
        })}
      </ul>

      {picking ? (
        <div className={PANEL} role="group" aria-label="Add an attribute">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <CustomInput label="Search attributes" dir="auto" leftIcon={Search} placeholder="Material, اللون, fit…" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={swallowEnter} autoFocus />
            </div>
            <CustomButton type="button" variant="ghost" size="icon" className="min-h-[var(--st-tap-min)] min-w-[var(--st-tap-min)] shrink-0" aria-label="Close attribute search" onClick={closePicker}>
              <X className="size-4" aria-hidden="true" />
            </CustomButton>
          </div>
          {query.isError ? (
            <p role="alert" className="text-[var(--st-status-danger)]">
              Existing attributes couldn&apos;t be loaded, so a new one can&apos;t be checked for duplicates.{" "}
              <button type="button" className={`underline ${FOCUS}`} onClick={() => void query.refetch()}>
                Try again
              </button>
            </p>
          ) : !catalogReady ? (
            <p role="status" className="text-[var(--st-ink-muted)]">
              Loading attributes…
            </p>
          ) : results.length === 0 ? (
            <p role="status" className="text-[var(--st-ink-muted)]">
              {pool.length === 0 ? "No attributes exist yet." : search.trim() ? <>No existing attribute matches “<span dir="auto">{search.trim()}</span>”.</> : "No attributes."}
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col overflow-y-auto border border-[var(--st-line)]" aria-label="Existing attributes">
              {results.map((entry) => {
                const added = onProduct.has(entry.key);
                return (
                  <li key={entry.key} className="border-b border-[var(--st-line)] last:border-b-0">
                    <button
                      type="button"
                      disabled={disabled || added}
                      onClick={() => addExisting(entry)}
                      className={`flex w-full ${TAP} flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-start hover:bg-[var(--st-accent-soft)] disabled:opacity-60 ${FOCUS}`}
                    >
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-medium">
                        <NameText name={entry.name} fallback={entry.key} />
                      </span>
                      <span className="text-[13px] text-[var(--st-ink-muted)]">
                        <span className="st-figure">{entry.key}</span>
                        {added ? " · already added" : entry.productCount > 0 ? ` · ${entry.values.length} ${entry.values.length === 1 ? "value" : "values"}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div>
            <CustomButton type="button" variant="outline" leftIcon={Plus} className={TAP} disabled={disabled || !catalogReady} onClick={() => void createNew()}>
              {search.trim() ? <>Create a new attribute “{search.trim()}”</> : "Create a new attribute"}
            </CustomButton>
          </div>
        </div>
      ) : (
        <div>
          <CustomButton type="button" variant="outline" leftIcon={Plus} className={TAP} disabled={disabled} onClick={openPicker}>
            Add attribute
          </CustomButton>
        </div>
      )}

      {notice ? (
        <p role="status" className="text-[var(--st-ink-muted)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] font-medium text-[var(--st-status-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
