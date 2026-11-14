"use client";

import { classifyApiError, requester, useRequesterQuery } from "@kira-joo/frontend-toolkit-core";
import { FeatureFilterCombobox } from "@kira-joo/frontend-toolkit-tailwind/combobox";
import { CustomButton, toast, showApiErrorToast } from "@kira-joo/frontend-toolkit-tailwind/primitives";
import { ArrowDown, ArrowUp, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { listProductGroupsEndpoint, setProductGroupMembersEndpoint, type ProductGroup } from "src/api/product-groups.endpoints";
import { listProductsEndpoint, type ProductListItem } from "src/api/products.endpoints";
import { AppRoute } from "src/common/routes/app-route";
import { ProductLifecycleSignal } from "src/features/status/status-signal";
import { MAX_GROUP_MEMBERS, membershipProblems } from "src/server/catalog/product-group-rules";
import { displayName } from "../catalog-display";
import { LocalizedPair } from "../products/localized-pair";
import { GroupThumb } from "./group-thumb";
import { addRow, membersChanged, moveRow, rowsOf, toInputs, type MemberRow } from "./group-members";

/**
 * The group’s products, in the order customers see them, each with the label customers see. One "Save" sends the
 * whole list with the revision it was loaded at; if someone else changed the group meanwhile the save is refused and
 * nothing here is lost — staff reload and redo the change.
 */
export function MembersEditor({ group, canEdit, onSaved, onReload }: { group: ProductGroup; canEdit: boolean; onSaved: () => void; onReload: () => void }) {
  const [rows, setRows] = useState<MemberRow[]>(() => rowsOf(group));
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const groups = useRequesterQuery({ endpoint: listProductGroupsEndpoint, options: { query: { limit: 100 } } });
  const groupName = useMemo(() => new Map((groups.data?.data ?? []).map((g) => [g._id, displayName(g.name)])), [groups.data]);

  const problems = membershipProblems(toInputs(rows));
  const dirty = membersChanged(rows, group);
  const update = (index: number, next: Partial<MemberRow>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...next } : row)));

  function add(product: ProductListItem | undefined) {
    if (!product) return;
    const elsewhere = product.group && product.group.groupId !== group._id ? (groupName.get(product.group.groupId) ?? "another group") : undefined;
    setRows((current) =>
      addRow(current, {
        productId: product._id,
        name: product.name,
        slug: product.slug,
        lifecycle: product.lifecycle,
        image: undefined,
        // A product moving in keeps the label it had in its old group as a starting point; staff can change it.
        label: product.group ? { ...product.group.label } : { en: "", ar: "" },
        movesFrom: elsewhere,
      })
    );
  }

  async function save() {
    setAttempted(true);
    if (problems.length > 0) return;
    setBusy(true);
    try {
      await requester(setProductGroupMembersEndpoint, { params: { id: group._id }, body: { expectedRevision: group.revision, members: toInputs(rows) } });
      toast.success("Group saved");
      onSaved();
    } catch (error) {
      if (classifyApiError(error) === "conflict") setStale(true);
      showApiErrorToast(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="group-members-heading" className="flex flex-col gap-4 rounded-lg border border-[var(--st-line)] bg-[var(--st-surface)] p-4 sm:p-5">
      <header className="flex flex-col gap-1">
        <h2 id="group-members-heading" className="text-base font-semibold text-[var(--st-ink)]">
          Products in this group
        </h2>
        <p className="text-[13px] text-[var(--st-ink-muted)]">
          On each product’s page, customers see the other published products here as alternatives, in this order, under these labels. Drafts and archived products stay listed here but are not shown to customers.
        </p>
      </header>

      {stale ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--st-status-warning,var(--st-line))] p-3 text-[13px]">
          <span>Someone else changed this group since you opened it. Reload to see their changes, then make yours again.</span>
          <CustomButton variant="outline" onClick={onReload}>
            Reload group
          </CustomButton>
        </div>
      ) : null}

      {rows.length === 0 ? <p className="text-[var(--st-ink-muted)]">No products yet. Add the first one below.</p> : null}
      <ol className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.productId} className="grid gap-3 rounded-md border border-[var(--st-line)] p-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <div className="flex min-w-0 items-center gap-3">
              <span className="st-figure w-6 flex-none text-center text-[13px] text-[var(--st-ink-muted)]" aria-hidden="true">
                {index + 1}
              </span>
              <GroupThumb image={row.image} />
              <div className="flex min-w-0 flex-col gap-1">
                <Link href={AppRoute.PRODUCT(row.productId)} className="inline-flex min-w-0 items-center gap-1 font-medium text-[var(--st-ink)] hover:underline">
                  <span dir="auto" className="truncate">
                    {displayName(row.name)}
                  </span>
                  <ExternalLink aria-hidden="true" className="size-3.5 flex-none" />
                </Link>
                <span className="flex flex-wrap items-center gap-2 text-[13px]">
                  <ProductLifecycleSignal lifecycle={row.lifecycle} />
                  {row.movesFrom ? <span className="text-[var(--st-ink-muted)]">Moves here from {row.movesFrom} when you save</span> : null}
                </span>
              </div>
            </div>
            <LocalizedPair label={`Label for ${displayName(row.name) || `product ${index + 1}`}`} value={row.label} disabled={!canEdit || busy} onChange={(label) => update(index, { label })} />
            {canEdit ? (
              <div className="flex gap-1 lg:justify-end">
                <CustomButton type="button" variant="ghost" size="icon" aria-label={`Move ${displayName(row.name)} up`} disabled={busy || index === 0} onClick={() => setRows((current) => moveRow(current, index, -1))}>
                  <ArrowUp className="size-4" aria-hidden="true" />
                </CustomButton>
                <CustomButton type="button" variant="ghost" size="icon" aria-label={`Move ${displayName(row.name)} down`} disabled={busy || index === rows.length - 1} onClick={() => setRows((current) => moveRow(current, index, 1))}>
                  <ArrowDown className="size-4" aria-hidden="true" />
                </CustomButton>
                <CustomButton type="button" variant="ghost" size="icon" aria-label={`Remove ${displayName(row.name)} from the group`} disabled={busy} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </CustomButton>
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {canEdit ? (
        <div className="flex flex-col gap-3 border-t border-[var(--st-line)] pt-4">
          <div className="max-w-xl">
            <span id="add-product-label" className="mb-1 block text-[13px] font-medium text-[var(--st-ink)]">
              Add a product
            </span>
            <FeatureFilterCombobox<ProductListItem, typeof listProductsEndpoint>
              key={rows.length}
              endpoint={listProductsEndpoint}
              searchQueryKey="search"
              query={{ limit: 20 }}
              optionLabel={(product) => `${displayName(product.name)}${product.group && product.group.groupId !== group._id ? ` — in ${groupName.get(product.group.groupId) ?? "another group"}` : ""}`}
              optionValue="_id"
              placeholder="Search products by name"
              emptyMessage="No matching products"
              onChange={(_value, product) => add(product)}
            />
            <p className="mt-1 text-[13px] text-[var(--st-ink-muted)]">A product can be in one group. Adding a product from another group moves it here when you save. At most {MAX_GROUP_MEMBERS} products.</p>
          </div>
          {attempted && problems.length > 0 ? (
            <ul role="alert" className="list-disc ps-5 text-[13px] font-medium text-[var(--st-status-danger)]">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <CustomButton onClick={() => void save()} loading={busy} disabled={busy || !dirty || stale}>
              Save group
            </CustomButton>
            {dirty ? <span className="text-[13px] text-[var(--st-ink-muted)]">Unsaved changes</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
